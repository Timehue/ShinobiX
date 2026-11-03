import { expect, test } from "@playwright/test";
import { expectUiAuditBoot, installUiAuditRuntime, uiAuditSave } from "./helpers/ui-audit-runtime";

function waterSave() {
    const save = uiAuditSave();
    save.character = {
        ...save.character,
        specialty: "Genjutsu",
        element: "Water",
        elements: ["Water"],
        equippedJutsuIds: [],
        stats: { ...(save.character?.stats as Record<string, number>), genjutsuOffense: 2500 },
        jutsuMastery: [{ jutsuId: "starter-nin-water-5", level: 50, xp: 0 }],
    };
    return save;
}

test("the Jutsu Hall describes Undertow Fang's own hit for a Genjutsu player", async ({ page }) => {
    const runtime = await installUiAuditRuntime(page, waterSave());
    await expectUiAuditBoot(page, runtime, "jutsuTraining");
    await page.locator(".technique-grid .technique-name").filter({ hasText: "Undertow Fang" }).click();
    const details = page.locator(".jutsu-detail-stack").filter({ visible: true }).first();
    await expect(details).toContainText("Ninjutsu");
    await expect(details).toContainText("Water");
    await expect(details).toContainText(/Heals the user for \d+% of the damage this hit deals\./);
    await expect(details).not.toContainText("Genjutsu damage");
});

test("Profile's selected effect preview cannot relabel Undertow Fang's damage", async ({ page }) => {
    const runtime = await installUiAuditRuntime(page, waterSave());
    await expectUiAuditBoot(page, runtime, "profile");
    const mobileTabs = page.locator(".profile-mobile-tabs");
    if (await mobileTabs.isVisible()) await mobileTabs.getByRole("button", { name: "Jutsu" }).click();
    await page.locator("#jutsu-lens-discipline").selectOption("Genjutsu");
    await page.getByRole("tablist", { name: "Jutsu workspace" }).getByRole("tab", { name: /^Learned jutsu/ }).click();
    await page.locator(".jutsu-collection-select").filter({ hasText: "Undertow Fang" }).click();
    const details = (page.viewportSize()?.width ?? 1366) <= 860
        ? page.getByRole("dialog", { name: "Undertow Fang", exact: true }).locator(".jutsu-detail-content")
        : page.locator(".jutsu-details-section .jutsu-detail-content");
    await expect(details).toBeVisible();
    await expect(details).toContainText(/Heals the user for \d+% of the damage this hit deals\./);
    await expect(details).not.toContainText("Genjutsu damage");
});
