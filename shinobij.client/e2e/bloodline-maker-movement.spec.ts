import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { applyBloodlineForgePurchase } from "../../api/bloodlines/_forge";
import { normalizePlayerBloodlineJutsus } from "../../api/bloodlines/_jutsu-schema";
import { expectUiAuditBoot, installUiAuditRuntime, uiAuditSave } from "./helpers/ui-audit-runtime";

test("damaging Move keeps its required tag through method switching and server save", async ({ page }) => {
    const save = uiAuditSave();
    const character = { ...save.character, mythicSeals: 140, element: "Lightning", elements: ["Lightning"] };
    save.character = character;
    save.savedBloodlines = [];
    const runtime = await installUiAuditRuntime(page, save);
    await page.route("**/api/bloodlines/forge", async route => {
        const result = applyBloodlineForgePurchase(character, [], "S Rank", randomUUID(), Date.now());
        expect(result.ok).toBe(true);
        if (!result.ok) return route.abort();
        const version = runtime.currentVersion() + 1;
        runtime.commitServerCharacter(result.character, version);
        await route.fulfill({ json: { ok: true, rank: "S Rank", character: result.character, _saveVersion: version } });
    });
    const posted: Array<{ rank: string; jutsus: Array<{ method: string; tags: Array<{ name: string }> }> }> = [];
    page.on("request", request => {
        if (request.method() !== "POST" || !request.headers()["x-bloodline-write-intent"]) return;
        posted.push(request.postDataJSON().savedBloodlines[0]);
    });
    await expectUiAuditBoot(page, runtime, "centralHub");
    await page.locator(".central-card").filter({ hasText: "Awakening Stone" }).click();
    await page.locator(".aw-forge-card.rank-s button").click();
    await expect(page.locator('.app-shell[data-screen="bloodlineMaker"]')).toBeVisible();
    await page.locator(".bloodline-wizard-next").click();
    const method = page.getByRole("combobox", { name: "Jutsu method", exact: true });
    const first = page.getByRole("combobox", { name: "Tag 1", exact: true });
    const second = page.getByRole("combobox", { name: "Tag 2", exact: true });
    await page.getByRole("button", { name: "40 AP utility", exact: true }).click();
    await first.selectOption("Move");
    await second.selectOption("Push");
    await expect(method).toHaveValue("SINGLE");
    await expect(first).toBeEnabled();
    await page.getByRole("button", { name: "60 AP damage", exact: true }).click();
    await expect(method).toHaveValue("AOE_CIRCLE");
    await expect(first).toHaveValue("Move");
    await expect(first).toBeDisabled();
    await expect(second).toHaveValue("Push");
    await method.selectOption("SINGLE");
    await expect(method).toHaveValue("SINGLE");
    await expect(first).toHaveValue("Push");
    await expect(first).toBeEnabled();
    // Adding Move in either slot must protect it, without losing its neighbor.
    await second.selectOption("Move");
    await expect(method).toHaveValue("AOE_CIRCLE");
    await expect(second).toBeDisabled();
    await first.selectOption("Poison");
    await expect(first).toHaveValue("Poison");
    await expect(second).toHaveValue("Move");
    for (let step = 0; step < 8 && await page.locator(".bloodline-wizard-next").count(); step++) {
        await page.locator(".bloodline-wizard-next").click();
    }
    await page.getByRole("button", { name: "Awaken bloodline", exact: true }).click();
    await expect.poll(() => posted.length).toBe(1);
    const authored = posted[0].jutsus[0];
    const canonical = normalizePlayerBloodlineJutsus(posted[0].jutsus, posted[0].rank)[0];
    expect(authored.method).toBe("AOE_CIRCLE");
    expect(authored.tags.map(tag => tag.name).sort()).toEqual(["Move", "Poison"]);
    expect(canonical.tags.map(tag => tag.name).sort()).toEqual(authored.tags.map(tag => tag.name).sort());
});
