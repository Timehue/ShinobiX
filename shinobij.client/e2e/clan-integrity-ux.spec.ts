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
        await new Promise((resolve) => setTimeout(resolve, 150));
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
    const busyButtons = page.getByRole("button", { name: "Claiming…" });
    await expect(busyButtons.first()).toBeDisabled();
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
