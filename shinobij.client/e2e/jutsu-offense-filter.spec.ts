import { expect, test } from "@playwright/test";
import { expectUiAuditBoot, installUiAuditRuntime, uiAuditSave } from "./helpers/ui-audit-runtime";

// 40-AP jutsu are typed "Any" because they work with every offense, so choosing
// an offense must keep them. Unit tests cover the rule in lib/jutsu-options;
// these prove both screens with an Offense filter are actually wired to it.
const LEARNED = ["starter-buki-earth-1", "starter-buki-earth-2", "starter-nin-earth-2", "starter-nin-earth-3"];

function earthSave() {
    const save = uiAuditSave();
    save.character = {
        ...save.character,
        element: "Earth",
        elements: ["Earth"],
        equippedJutsuIds: [],
        jutsuMastery: LEARNED.map((jutsuId) => ({ jutsuId, level: 10, xp: 0 })),
    };
    return save;
}

test("the Jutsu Hall offense filter keeps the 40 AP jutsu of the chosen element", async ({ page }) => {
    const runtime = await installUiAuditRuntime(page, earthSave());
    await expectUiAuditBoot(page, runtime, "jutsuTraining");

    const filters = page.locator(".technique-filter-panel select");
    const names = () => page.locator(".technique-grid .technique-name").allTextContents();

    await filters.nth(0).selectOption("Bukijutsu");
    await filters.nth(1).selectOption("Earth");
    const bukijutsu = await names();
    expect(bukijutsu).toContain("Adamant Chain Pull");
    expect(bukijutsu).toContain("Stone Kunai Rain");
    expect(bukijutsu, "another discipline's 40 AP jutsu works with Bukijutsu too").toContain("Bedrock Chakra Focus");
    expect(bukijutsu, "another discipline's 60 AP jutsu stays out").not.toContain("Mud Coffin Bind");

    await filters.nth(0).selectOption("Any");
    const any = await names();
    expect(any).toContain("Stone Kunai Rain");
    expect(any).not.toContain("Adamant Chain Pull");
});

test("the Profile collection offense filter keeps learned 40 AP jutsu", async ({ page }) => {
    const runtime = await installUiAuditRuntime(page, earthSave());
    await expectUiAuditBoot(page, runtime, "profile");

    // Phones hide the panel behind a tab; wider screens show it in the page flow.
    const mobileTabs = page.locator(".profile-mobile-tabs");
    if (await mobileTabs.isVisible()) await mobileTabs.getByRole("button", { name: "Jutsu" }).click();
    await page.getByRole("tablist", { name: "Jutsu workspace" }).getByRole("tab", { name: /^Learned jutsu/ }).click();

    const collection = page.locator("#jutsu-workspace-collection");
    await collection.getByLabel("Filter by offense").selectOption("Bukijutsu");
    await expect(collection.getByText("Adamant Chain Pull").first()).toBeVisible();
    await expect(collection.getByText("Stone Kunai Rain").first()).toBeVisible();
    await expect(collection.getByText("Iron Sand Burst").first()).toBeVisible();
    await expect(collection.getByText("Mud Coffin Bind")).toHaveCount(0);
});
