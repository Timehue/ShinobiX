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

    // What the coast's own routes answer. `held` flips once the clan has taken the ground.
    let held = false;
    let contest: Record<string, unknown> | null = null;
    let school: string | undefined;
    let fixedSky: string | undefined;
    let declareMode: "refused" | "success" = "refused";
    const landBodies: Array<Record<string, unknown>> = [];
    let supplyRequests = 0;
    let deleteRequests = 0;
    // Deferred gate for the in-flight declaration; released by the test once it
    // has seen the button go busy. A fixed sleep here loses that race on a
    // loaded machine. Awaiting an already-resolved gate is a no-op.
    let releaseDeclare: () => void = () => {};
    const declareHeld = new Promise<void>((resolve) => { releaseDeclare = resolve; });

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
    await page.route("**/api/world-state**", (route) => json(route, { territories: [], wars: [], standings: [] }));
    await page.route("**/api/coast/land", async (route) => {
        const body = route.request().postDataJSON() as Record<string, unknown>;
        if (body.action !== "status") landBodies.push(body);
        if (body.action === "declare") {
            if (declareMode === "refused") return json(route, { error: "The clan hall needs 75 Territory Control Scrolls to declare for land." }, 409);
            await declareHeld;
            const now = Date.now();
            contest = { id: "contest-1", clan: "Shadow Cell", phase: "posted", opensAt: now + 86_400_000, closesAt: now + 3 * 86_400_000, score: 0, target: 15, roster: 5 };
            return json(route, { ok: true, contest });
        }
        if (body.action === "terrain") {
            school = String(body.terrainBuffStat);
            return json(route, { ok: true, claim: { sector: 102, terrainBuffStat: school } });
        }
        if (body.action === "weather") {
            fixedSky = body.weather === "scheduled" ? undefined : String(body.weather);
            return json(route, { ok: true, claim: { sector: 102, weather: fixedSky } });
        }
        return json(route, {
            ok: true,
            rules: { noticeMs: 86_400_000, windowMs: 2 * 86_400_000, minMembers: 5, target: 15, perPlayerCap: 5, declareScrolls: 75 },
            sectors: [{
                sector: 102, name: "Wrack Strand", region: 1,
                sky: { weather: held && fixedSky ? fixedSky : "tornado", fixed: held && !!fixedSky },
                holder: held ? { clan: "Shadow Cell", since: Date.now() - 3 * 86_400_000, immuneUntil: 0, ...(school ? { terrainBuffStat: school } : {}), ...(fixedSky ? { weather: fixedSky } : {}) } : null,
                contest: held ? null : contest,
            }],
            paused: false,
        });
    });
    await page.route("**/api/coast/landing", (route) => json(route, {
        ok: true,
        rules: { tiers: [], materials: [], materialNames: {}, memberWeeklyCap: 0, perContribution: 0 },
        clan: "Shadow Cell", officer: true, canFound: false,
        holds: held ? { sector: 102, name: "Wrack Strand", supply: 200 } : null,
        landing: null, fallen: null, inTown: false,
    }));
    await page.route("**/api/clan/territory/collect-supply", (route) => {
        supplyRequests += 1;
        return json(route, { ok: true, collected: 200, treasury: { ...treasury(75), warSupply: 500 } });
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
    // Clans hold land on the coast only: nothing on the home map is offered for capture.
    await expect(page.getByRole("button", { name: /Capture sector/ })).toHaveCount(0);
    const coast = page.getByRole("region", { name: "Coast land and Landing" });
    await expect(coast.getByText("Held by the Unmoored.")).toBeVisible();
    await expect(coast.getByText("Declaring takes 75 Territory Control Scrolls from the clan hall.", { exact: false })).toBeVisible();

    // A refusal is shown in the server's own words, and nothing changes.
    const declare = coast.getByRole("button", { name: "Declare contest", exact: true });
    await declare.click();
    await expect(coast.getByText("The clan hall needs 75 Territory Control Scrolls to declare for land.")).toBeVisible();
    expect(landBodies.filter((body) => body.action === "declare")).toHaveLength(1);
    await expect(coast.getByText("Held by the Unmoored.")).toBeVisible();

    // A double click posts one declaration, so the scrolls cannot be spent twice.
    declareMode = "success";
    await declare.evaluate((button) => {
        (button as HTMLButtonElement).click();
        (button as HTMLButtonElement).click();
    });
    // The declaration is held open by `declareHeld`, so this window cannot close
    // before the assertion runs no matter how loaded the machine is.
    await expect(declare).toBeDisabled();
    releaseDeclare();
    await expect(coast.getByText("Contest posted.")).toBeVisible();
    const declares = landBodies.filter((body) => body.action === "declare");
    expect(declares).toHaveLength(2);
    expect(declares[1]).toMatchObject({ action: "declare", sector: 102 });
    await expect(coast.getByText("Shadow Cell · posted · 0/15 points · 5 on roster.")).toBeVisible();
    await expect(coast.getByRole("button", { name: "Withdraw contest", exact: true })).toBeVisible();

    // The clan takes the ground. Its officers choose the school it favours there.
    held = true;
    await coast.getByRole("button", { name: "Refresh coast status", exact: true }).click();
    await expect(coast.getByText("Held by Shadow Cell.")).toBeVisible();
    await expect(coast.getByText("Shadow Cell holds Wrack Strand. 200 War Supply is ready to collect in the Clan Hall.")).toBeVisible();
    await coast.getByLabel("Favoured school").selectOption("Ninjutsu");
    await expect(coast.getByText("Favoured school saved.")).toBeVisible();
    expect(landBodies.filter((body) => body.action === "terrain")).toEqual([{ action: "terrain", sector: 102, terrainBuffStat: "ninjutsuOffense" }]);
    await expect(coast.getByText("Shadow Cell favours Ninjutsu here.", { exact: false })).toBeVisible();

    // The sky over the sector is the coast's own until the clan's officers fix it.
    await expect(coast.getByText("Weather: Tornado. Wind damage +5%. Earth damage -2%.")).toBeVisible();
    await coast.getByLabel("Sector weather").selectOption("Rainstorm");
    await expect(coast.getByText("Sector weather saved.")).toBeVisible();
    expect(landBodies.filter((body) => body.action === "weather")).toEqual([{ action: "weather", sector: 102, weather: "rain" }]);
    await expect(coast.getByText("Weather: Rainstorm. Water damage +5%. Fire damage -2%. Shadow Cell keeps it so.")).toBeVisible();

    // War Supply comes from the coast sector, through the same collection as before.
    await page.getByRole("button", { name: "Collect Sector War Supply", exact: true }).click();
    await expect(page.getByText(/Clan War Supply:\s*500/)).toBeVisible();
    expect(supplyRequests).toBe(1);
    if (await contextualTipDismiss.isVisible()) await contextualTipDismiss.click();

    const deleteButton = page.getByRole("button", { name: "Delete clan", exact: true });
    await deleteButton.evaluate((button) => button.scrollIntoView({ block: "center" }));
    await expect(deleteButton).toBeInViewport();
    await deleteButton.click();
    const confirmation = page.getByRole("alertdialog", { name: "Confirm" });
    await expect(confirmation).toContainText("removes every member");
    await expect(confirmation).toContainText("releases its territory");
    await expect(confirmation).toContainText("forfeits active clan wars");
    // A destructive confirmation opens on Cancel, so a stray Enter cannot
    // delete the clan, and it exposes its explanation to screen readers.
    await expect(confirmation.getByRole("button", { name: "Cancel", exact: true })).toBeFocused();
    await expect(confirmation).toHaveAccessibleDescription(/removes every member/);
    await confirmation.getByRole("button", { name: "Cancel" }).click();
    expect(deleteRequests).toBe(0);
    await expect(deleteButton).toBeEnabled();

    await deleteButton.evaluate((button) => {
        (button as HTMLButtonElement).click();
        (button as HTMLButtonElement).click();
    });
    await page.getByRole("alertdialog", { name: "Confirm" }).getByRole("button", { name: "Delete" }).click();
    await expect(page.getByRole("button", { name: "Deleting clan…" })).toBeDisabled();
    await expect.poll(() => deleteRequests).toBe(1);
    await expect(page.getByRole("heading", { name: "Create Clan" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Delete clan", exact: true })).toHaveCount(0);
    // The one refused declaration above is the only failed request this journey makes.
    expect(runtimeErrors.filter((message) => !/Failed to load resource:.*409 \(Conflict\)/.test(message))).toEqual([]);
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
    await page.getByRole("button", { name: "Post clan notice", exact: true }).click();

    await expect.poll(() => writes.length).toBe(writesBeforeNotice + 1);
    const posted = writes[writes.length - 1] as { treasury?: unknown; joinRequests: Array<{ name: string }>; notices: Array<{ id: string; title: string }> };
    expect(Object.hasOwn(posted, "treasury"), "an update never replays the treasury").toBe(false);
    expect(posted.joinRequests.map((request) => request.name), "a join request sent since the hall opened survives").toEqual(["LateRecruit"]);
    expect(posted.notices.map((notice) => notice.id), "another leader's notice posted since survives").toContain("other-leader-order");
    expect(posted.notices.some((notice) => notice.title === "Rally at the gate")).toBe(true);
    // And the board now shows the clan as it stands, not the opening copy.
    await expect(page.getByText("Hold Sector 40")).toBeVisible();
});
