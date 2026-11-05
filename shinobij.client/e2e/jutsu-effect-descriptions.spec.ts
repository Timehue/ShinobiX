import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { applyBloodlineForgePurchase } from "../../api/bloodlines/_forge";
import { normalizePlayerBloodlineJutsus } from "../../api/bloodlines/_jutsu-schema";
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
    // Where the side details panel is hidden (<=800px), the card's "?" opens them.
    const info = page.getByRole("button", { name: "Undertow Fang info" });
    if (await info.isVisible()) await info.click();
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

for (const offense of ["Ninjutsu", "Genjutsu", "Taijutsu", "Bukijutsu"] as const) {
    test(`${offense} previews and save agree through AP changes and a buff tile`, async ({ page }) => {
        const save = uiAuditSave();
        const character = { ...save.character, mythicSeals: 140, element: "Lightning", elements: ["Lightning"] };
        save.character = character;
        save.savedBloodlines = [];
        const runtime = await installUiAuditRuntime(page, save);
        await page.route("**/api/bloodlines/forge", async route => {
            const purchase = applyBloodlineForgePurchase(character, [], "S Rank", randomUUID(), Date.now());
            expect(purchase.ok).toBe(true);
            if (!purchase.ok) return route.abort();
            const version = runtime.currentVersion() + 1;
            runtime.commitServerCharacter(purchase.character, version);
            await route.fulfill({ json: { ok: true, rank: "S Rank", character: purchase.character, _saveVersion: version } });
        });
        const posted: Array<{ rank: string; jutsus: Array<{ ap: number; type: string; method: string; tags: Array<{ name: string }> }> }> = [];
        page.on("request", request => {
            if (request.method() === "POST" && request.headers()["x-bloodline-write-intent"]) posted.push(request.postDataJSON().savedBloodlines[0]);
        });
        await expectUiAuditBoot(page, runtime, "centralHub");
        await page.locator(".central-card").filter({ hasText: "Awakening Stone" }).click();
        await page.locator(".aw-forge-card.rank-s button").click();
        await expect(page.locator('.app-shell[data-screen="bloodlineMaker"]')).toBeVisible();
        await page.getByRole("combobox").filter({ has: page.getByRole("option", { name: "Bukijutsu", exact: true }) }).selectOption(offense);
        await page.locator(".bloodline-wizard-next").click();
        await page.getByRole("combobox", { name: "Tag 1", exact: true }).selectOption("Increase Generals");
        const help = page.locator(".tag-picker .tag-effect-help").first();
        const summary = page.locator(".bloodline-effect-preview");
        await expect(help).toContainText("Raises");
        await page.getByRole("button", { name: "40 AP utility", exact: true }).click();
        await expect(page.locator(".maker-card")).toContainText("Any · Utility");
        await page.getByRole("button", { name: "60 AP damage", exact: true }).click();
        await expect(help).toContainText("Raises");
        await expect(summary).toContainText("Raises");
        await expect(page.locator(".maker-card")).toContainText(offense);
        await page.locator(".bloodline-wizard-next").click();
        await page.getByRole("button", { name: "40 AP utility", exact: true }).click();
        const method = page.getByRole("combobox", { name: "Jutsu method", exact: true });
        const first = page.getByRole("combobox", { name: "Tag 1", exact: true });
        const second = page.getByRole("combobox", { name: "Tag 2", exact: true });
        await method.selectOption("INSTANT_EFFECT");
        await first.selectOption("Lifesteal");
        await expect(help).toContainText("Buff tile: whoever stands on it heals");
        await expect(second.locator('option[value="Poison"]')).toBeDisabled();
        await expect(second.locator('option[value="Poison"]')).toHaveText("Poison [buff tile]");
        await second.selectOption("Move");
        await expect(summary).toContainText("buff tile");
        await page.getByRole("button", { name: "60 AP damage", exact: true }).click();
        await expect(first).toHaveValue("");
        await expect(page.locator(".maker-card")).toContainText(offense);
        await page.getByRole("button", { name: "40 AP utility", exact: true }).click();
        await first.selectOption("Lifesteal");
        await second.selectOption("Move");
        for (let step = 0; step < 8 && await page.locator(".bloodline-wizard-next").count(); step++) await page.locator(".bloodline-wizard-next").click();
        await page.getByRole("button", { name: "Awaken bloodline", exact: true }).click();
        await expect.poll(() => posted.length).toBe(1);
        expect(posted[0].jutsus[0]).toMatchObject({ ap: 60, type: offense });
        expect(posted[0].jutsus[1]).toMatchObject({ ap: 40, type: "Any", method: "INSTANT_EFFECT" });
        expect(posted[0].jutsus[1].tags.map(tag => tag.name)).toEqual(["Move", "Lifesteal"]);
        const canonical = normalizePlayerBloodlineJutsus(posted[0].jutsus, posted[0].rank);
        expect(canonical[0].type).toBe(offense);
        expect(canonical[1]).toMatchObject({ ap: 40, type: "Any", method: "INSTANT_EFFECT" });
        expect(canonical[1].tags.map(tag => tag.name)).toEqual(["Move", "Lifesteal"]);
    });

}
