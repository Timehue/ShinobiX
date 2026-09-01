import { expect, test, type Route } from "@playwright/test";
import { expectViewportSafe } from "./helpers/adaptive-assertions";
import { installUiAuditRuntime, uiAuditSave } from "./helpers/ui-audit-runtime";

function json(route: Route, body: unknown) {
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
}

test("mobile Clan roster reflows cleanly and owns the only Leave Clan action", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium-mobile", "the reported regression is specific to the phone Clan layout");

    const save = uiAuditSave();
    save.character = { ...save.character, clan: "Shadow Cell", clanFounder: false };
    await installUiAuditRuntime(page, save);

    const clan = {
        name: "Shadow Cell",
        village: "Stormveil Village",
        founderName: "FounderWithALongName",
        createdAt: Date.now() - 86_400_000,
        level: 8,
        xp: 300,
        treasury: { ryo: 25_000, fateShards: 0, boneCharms: 0, auraStones: 0, mythicSeals: 0, warSupply: 0, items: [] },
        members: [
            { name: "FounderWithALongName", village: "Stormveil Village", level: 100, specialty: "Taijutsu", battleContrib: 68, eventContrib: 5_000, missionContrib: 147, isFounder: true, month: "2026-09" },
            { name: "AuditNinja", village: "Stormveil Village", level: 45, specialty: "Taijutsu", battleContrib: 5, eventContrib: 16, missionContrib: 92, isFounder: false, month: "2026-09" },
        ],
        roleOverrides: {},
        joinRequests: [],
        notices: [],
        warHistory: [],
    };

    await page.route("**/api/save/clan-shadowcell", (route) => json(route, clan));
    await page.goto("/#/clan", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Shadow Cell" })).toBeVisible();

    await page.getByRole("button", { name: "Roster", exact: true }).click();
    const roster = page.locator(".clan-roster");
    await expect(roster.getByRole("button", { name: "Leave Clan", exact: true })).toBeVisible();
    await expect(page.getByText("Clan Exchange balance", { exact: true })).toHaveCount(0);

    const founderRow = page.locator(".clan-member-row-v2").first();
    const identity = await founderRow.locator(".clan-member-info").boundingBox();
    const contribution = await founderRow.locator(".clan-contrib-col").boundingBox();
    expect(identity).not.toBeNull();
    expect(contribution).not.toBeNull();
    expect(contribution!.y).toBeGreaterThanOrEqual(identity!.y + identity!.height - 1);
    await expectViewportSafe(page, { horizontalScrollers: [".clan-tabs"] });

    await page.getByRole("button", { name: "Treasury", exact: true }).click();
    await expect(page.getByRole("button", { name: "Leave Clan", exact: true })).toHaveCount(0);
    await expect(page.getByText("Clan Exchange balance", { exact: true })).toHaveCount(0);
});
