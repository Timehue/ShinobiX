import { expect, test, type Route } from "@playwright/test";
import { installUiAuditRuntime, uiAuditSave } from "./helpers/ui-audit-runtime";

function json(route: Route, body: unknown, status = 200) {
    return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

function treasury(scrolls: number) {
    return {
        ryo: 25_000,
        fateShards: 0,
        boneCharms: 0,
        auraStones: 0,
        mythicSeals: 0,
        warSupply: 300,
        items: scrolls > 0 ? [{ itemId: "territory-control-scroll", count: scrolls }] : [],
    };
}

function territory(owner = false) {
    return {
        sector: 40,
        ownerClan: owner ? "Shadow Cell" : undefined,
        ownerVillage: owner ? "Stormveil Village" : undefined,
        controlScore: owner ? 75_000 : 0,
        hp: 20_000,
        weather: "clear",
        terrainBuffStat: "bukijutsuOffense",
        guards: [],
        warSupply: 0,
        lastSupplyAt: Date.now(),
        updatedAt: Date.now(),
    };
}

test("Clan Hall territory and dissolution controls preserve authoritative player feedback", async ({ page }, testInfo) => {
    test.skip(
        !["chromium-desktop", "chromium-mobile"].includes(testInfo.project.name),
        "desktop and mobile Chromium cover this stateful integration without duplicating it in every engine",
    );

    const runtimeErrors: string[] = [];
    page.on("console", (message) => { if (message.type() === "error") runtimeErrors.push(message.text()); });
    page.on("pageerror", (error) => runtimeErrors.push(error.message));

    const save = uiAuditSave();
    save.character = {
        ...save.character,
        clan: "Shadow Cell",
        clanFounder: true,
        guardQueued: false,
    };
    const runtime = await installUiAuditRuntime(page, save);

    const clan = {
        name: "Shadow Cell",
        village: "Stormveil Village",
        founderName: "AuditNinja",
        createdAt: Date.now() - 86_400_000,
        level: 8,
        xp: 300,
        treasury: treasury(75),
        members: [
            { name: "AuditNinja", village: "Stormveil Village", level: 85, specialty: "Ninjutsu", battleContrib: 20, eventContrib: 10, missionContrib: 5, isFounder: true, month: "2026-08" },
            { name: "CellTwo", village: "Stormveil Village", level: 45, specialty: "Taijutsu", battleContrib: 4, eventContrib: 2, missionContrib: 1, isFounder: false, month: "2026-08" },
            { name: "CellThree", village: "Stormveil Village", level: 42, specialty: "Genjutsu", battleContrib: 3, eventContrib: 2, missionContrib: 1, isFounder: false, month: "2026-08" },
            ...Array.from({ length: 7 }, (_, index) => ({ name: `Cell${index + 4}`, village: "Stormveil Village", level: 40, specialty: "Ninjutsu", battleContrib: 1, eventContrib: 1, missionContrib: 1, isFounder: false, month: "2026-08" })),
        ],
        roleOverrides: {},
        joinRequests: [],
        notices: [],
        warHistory: [],
    };

    let worldTerritory = territory(false);
    let assignmentMode: "forbidden" | "success" = "forbidden";
    const assignmentBodies: Array<Record<string, unknown>> = [];
    let deleteRequests = 0;
    // Deferred gate for the in-flight claim window; released by the test once it
    // has seen the button go busy. See the assign-scrolls route below.
    let releaseAssignment: () => void = () => {};
    const assignmentHeld = new Promise<void>((resolve) => { releaseAssignment = resolve; });

    await page.route("**/api/save/clan-shadowcell", async (route) => {
        if (route.request().method() === "DELETE") {
            deleteRequests += 1;
      // Keep the mocked request in flight long enough for the loading-state
      // assertion to remain observable under the fully parallel browser matrix.
      await new Promise((resolve) => setTimeout(resolve, 400));
            return json(route, {
                ok: true,
                dissolution: { members: 3, membersCleared: 3, territoriesReleased: 1, warsForfeited: 1, replayed: false },
            });
        }
        return json(route, clan);
    });
    await page.route("**/api/world-state**", (route) => json(route, {
        territories: [worldTerritory],
        wars: [],
        standings: [],
    }));
    await page.route("**/api/clan/territory/assign-scrolls", async (route) => {
        assignmentBodies.push(route.request().postDataJSON() as Record<string, unknown>);
        if (assignmentMode === "forbidden") {
            return json(route, { ok: false, error: "Only clan leadership can assign Territory Control Scrolls." }, 403);
        }
        // Hold the successful claim open until the test has actually observed the
        // in-flight UI. This used to be a fixed 150 ms sleep, which lost the race
        // on a loaded machine: the response landed before Playwright could query
        // for the transient "Claiming…" button, and the spec failed with
        // "element(s) not found" about one run in three under `--repeat-each`.
        // The assertion it protects is worth keeping deterministic — it is what
        // proves a player cannot double-spend 75 Territory Scrolls by
        // double-clicking. Awaiting an already-resolved gate is a no-op, so any
        // later claim in this spec passes straight through.
        await assignmentHeld;
        worldTerritory = territory(true);
        return json(route, {
            ok: true,
            territory: worldTerritory,
            treasury: treasury(0),
            captured: true,
            spent: 75,
        });
    });

    await page.goto("/#/clan", { waitUntil: "domcontentloaded" });
    await expect(page.locator(".app-shell")).toHaveAttribute("data-screen", "clan");
    await expect(page.getByRole("complementary", { name: "Device and server saves diverged" })).toHaveCount(0);
    expect(runtime.currentVersion()).toBeGreaterThanOrEqual(1);
    await expect(page.getByRole("heading", { name: "Shadow Cell" })).toBeVisible();
    const contextualTipDismiss = page.locator(".screen-hint-dismiss");
    if (await contextualTipDismiss.isVisible()) await contextualTipDismiss.click();
    await page.getByRole("button", { name: "Territory", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Clan Territory Control" })).toBeVisible();
    await expect(page.getByText(/Clan Hall Scrolls:\s*75/)).toBeVisible();
    await expect(page.getByText("Control Score: 0 / 75,000")).toBeVisible();
    await expect(page.getByText(/Village Control:\s*No village control recorded/)).toBeVisible();
    await expect(page.getByText(/Clan Banner:\s*No clan banner planted/)).toBeVisible();
    await expect(page.getByText(/Claim Status:\s*Eligible — leadership may spend 75 scrolls/)).toBeVisible();

    await page.getByRole("button", { name: "Capture Sector (75 Scrolls)", exact: true }).click();
    let captureConfirmation = page.getByRole("alertdialog", { name: "Capture Sector 40" });
    await expect(captureConfirmation).toContainText("Village control: Stormveil Village");
    await expect(captureConfirmation).toContainText("Clan banner: Shadow Cell");
    await expect(captureConfirmation).toContainText("Weather: Clear Skies");
    await expect(captureConfirmation).toContainText("Terrain bonus: bukijutsu Offense +10%");
    await expect(captureConfirmation).toContainText("cannot be refunded");
    await captureConfirmation.getByRole("button", { name: "Cancel" }).click();
    expect(assignmentBodies).toHaveLength(0);

    await page.getByRole("button", { name: "Capture Sector (75 Scrolls)", exact: true }).click();
    captureConfirmation = page.getByRole("alertdialog", { name: "Capture Sector 40" });
    await captureConfirmation.getByRole("button", { name: "Spend 75 Scrolls" }).click();
    const notice = page.getByRole("alertdialog", { name: "Notice" });
    await expect(notice).toContainText("Only clan leadership can assign Territory Control Scrolls.");
    expect(assignmentBodies).toHaveLength(1);
    await expect(page.getByText(/Clan Hall Scrolls:\s*75/)).toBeVisible();
    await expect(page.getByText("Control Score: 0 / 75,000")).toBeVisible();
    await notice.getByRole("button", { name: "OK" }).click();

    assignmentMode = "success";
    await page.getByRole("button", { name: "Capture Sector (75 Scrolls)", exact: true }).evaluate((button) => {
        (button as HTMLButtonElement).click();
        (button as HTMLButtonElement).click();
    });
    captureConfirmation = page.getByRole("alertdialog", { name: "Capture Sector 40" });
    await expect(captureConfirmation).toHaveCount(1);
    expect(assignmentBodies).toHaveLength(1);
    await captureConfirmation.getByRole("button", { name: "Spend 75 Scrolls" }).click();
    // The claim is held open by `assignmentHeld`, so this window cannot close
    // before the assertion runs no matter how loaded the machine is.
    const busyButtons = page.getByRole("button", { name: "Claiming…" });
    await expect(busyButtons.first()).toBeDisabled();
    releaseAssignment();
    await expect.poll(() => assignmentBodies.length).toBe(2);
    await expect(page.getByText(/Clan Hall Scrolls:\s*0/)).toBeVisible();
    await expect(page.getByText("Control Score: 75,000 / 75,000")).toBeVisible();
    await expect(page.getByText(/Village Control:\s*Stormveil Village/)).toBeVisible();
    await expect(page.getByText(/Clan Banner:\s*Shadow Cell/)).toBeVisible();
    await expect(page.getByText(/Claim Status:\s*Owned by your clan/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Reinforce with 1 Scroll", exact: true })).toBeDisabled();
    expect(assignmentBodies[1]).toMatchObject({
        playerName: "AuditNinja",
        clan: "Shadow Cell",
        sector: 40,
        count: 75,
        weather: "clear",
        terrainBuffStat: "bukijutsuOffense",
    });
    expect(assignmentBodies[1]?.requestId).toEqual(expect.any(String));

    const breachedAt = Date.now();
    worldTerritory = {
        ...worldTerritory,
        hp: 0,
        breachedAt,
        breachEndsAt: breachedAt + 12 * 60 * 60 * 1000,
        updatedAt: breachedAt,
    };
    await page.getByRole("button", { name: "← Village" }).click();
    await page.reload({ waitUntil: "domcontentloaded" });
    const breachChip = page.getByRole("button", { name: /Sector 40 breached · 12h left/ });
    await expect(breachChip).toBeVisible({ timeout: 10_000 });
    await breachChip.click();
    await expect(page.locator(".app-shell")).toHaveAttribute("data-screen", "clan");
    await expect(page.getByRole("heading", { name: "Clan Territory Control" })).toBeVisible();
    await expect(page.getByText(/BREACHED:.*restore HP before/i)).toBeVisible();
    if (await contextualTipDismiss.isVisible()) await contextualTipDismiss.click();

    const deleteButton = page.getByRole("button", { name: "Delete Clan", exact: true });
    await deleteButton.evaluate((button) => button.scrollIntoView({ block: "center" }));
    await expect(deleteButton).toBeInViewport();
    await deleteButton.click();
    const confirmation = page.getByRole("alertdialog", { name: "Confirm" });
    await expect(confirmation).toContainText("removes every member");
    await expect(confirmation).toContainText("releases its territory");
    await expect(confirmation).toContainText("forfeits active clan wars");
    await confirmation.getByRole("button", { name: "Cancel" }).click();
    expect(deleteRequests).toBe(0);
    await expect(deleteButton).toBeEnabled();

    await deleteButton.evaluate((button) => {
        (button as HTMLButtonElement).click();
        (button as HTMLButtonElement).click();
    });
    await page.getByRole("alertdialog", { name: "Confirm" }).getByRole("button", { name: "Delete" }).click();
    await expect(page.getByRole("button", { name: "Deleting Clan..." })).toBeDisabled();
    await expect.poll(() => deleteRequests).toBe(1);
    await expect(page.getByRole("heading", { name: "Create Clan" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Delete Clan", exact: true })).toHaveCount(0);
    expect(runtimeErrors.filter((message) => !/Failed to load resource:.*403 \(Forbidden\)/.test(message))).toEqual([]);
});

// The Clan Hall loads the clan once and does not poll, yet every change writes
// the WHOLE clan document back. Built from the copy the hall opened with, that
// write replayed the treasury (erasing donations made since, for leadership)
// and dropped join requests and other leaders' notices posted since.
test("a Clan Hall change lands on the clan as it stands now, not the copy the hall opened with", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium-desktop", "one engine covers the save contract; the change is not layout");

    const save = uiAuditSave();
    save.character = { ...save.character, clan: "Shadow Cell", clanFounder: true, guardQueued: false };
    await installUiAuditRuntime(page, save);

    const founder = { name: "AuditNinja", village: "Stormveil Village", level: 85, specialty: "Ninjutsu", battleContrib: 20, eventContrib: 10, missionContrib: 5, isFounder: true, month: "2026-08" };
    const opened = {
        name: "Shadow Cell",
        village: "Stormveil Village",
        founderName: "AuditNinja",
        createdAt: Date.now() - 86_400_000,
        level: 8,
        xp: 300,
        treasury: treasury(0),
        members: [founder],
        roleOverrides: {},
        joinRequests: [] as Array<Record<string, unknown>>,
        notices: [] as Array<Record<string, unknown>>,
        warHistory: [],
    };
    // What other players did while this Founder had the hall open.
    const lateRequest = { name: "LateRecruit", village: "Stormveil Village", level: 30, specialty: "Ninjutsu", battleContrib: 0, eventContrib: 0, missionContrib: 0, isFounder: false, requestedAt: Date.now() };
    const otherLeaderNotice = { id: "other-leader-order", type: "clan", title: "Hold Sector 40", body: "Guard rotation at dusk.", author: "CellTwo", authorRole: "Leader", createdAt: Date.now(), pinned: false };
    const latest = { ...opened, treasury: { ...treasury(0), ryo: 90_000 }, joinRequests: [lateRequest], notices: [otherLeaderNotice] };

    let served: typeof opened = opened;
    const writes: Array<Record<string, unknown>> = [];
    await page.route("**/api/save/clan-shadowcell", async (route) => {
        if (route.request().method() === "POST") {
            writes.push(route.request().postDataJSON() as Record<string, unknown>);
            return json(route, { ok: true });
        }
        return json(route, served);
    });
    await page.route("**/api/world-state**", (route) => json(route, { territories: [], wars: [], standings: [] }));

    await page.goto("/#/clan", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Shadow Cell" })).toBeVisible();
    // The load-time member sync is an update too: it must not carry the treasury.
    await expect.poll(() => writes.length).toBeGreaterThanOrEqual(1);
    expect(Object.hasOwn(writes[0], "treasury")).toBe(false);
    const writesBeforeNotice = writes.length;

    served = latest;
    const contextualTipDismiss = page.locator(".screen-hint-dismiss");
    if (await contextualTipDismiss.isVisible()) await contextualTipDismiss.click();
    await page.getByRole("button", { name: "Notices", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Clan Notice Board" })).toBeVisible();
    await page.getByPlaceholder("Example: Prepare Sector 33 raid team").fill("Rally at the gate");
    await page.getByPlaceholder("Post clan plans, resource needs, guard rotations, or war instructions.").fill("Everyone to the east gate at dusk.");
    await page.getByRole("button", { name: "Post Clan Notice", exact: true }).click();

    await expect.poll(() => writes.length).toBe(writesBeforeNotice + 1);
    const posted = writes[writes.length - 1] as { treasury?: unknown; joinRequests: Array<{ name: string }>; notices: Array<{ id: string; title: string }> };
    expect(Object.hasOwn(posted, "treasury"), "an update never replays the treasury").toBe(false);
    expect(posted.joinRequests.map((request) => request.name), "a join request sent since the hall opened survives").toEqual(["LateRecruit"]);
    expect(posted.notices.map((notice) => notice.id), "another leader's notice posted since survives").toContain("other-leader-order");
    expect(posted.notices.some((notice) => notice.title === "Rally at the gate")).toBe(true);
    // And the board now shows the clan as it stands, not the opening copy.
    await expect(page.getByText("Hold Sector 40")).toBeVisible();
});
