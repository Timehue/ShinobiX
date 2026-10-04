import { expect, test, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { applyBloodlineForgePurchase } from "../../api/bloodlines/_forge";
import { expectUiAuditBoot, installUiAuditRuntime, uiAuditSave, type UiAuditSave } from "./helpers/ui-audit-runtime";

// Idle regen replaces the character every second while a vital is below max.
// The Bloodline Maker's archive swap awaits a confirm and its forge save awaits
// image uploads and the save itself; neither may hand back the HP the player
// had when they clicked.

const CUSTOM_ID = "bl-audit-wood";

function lowHpSave(): UiAuditSave {
    const save = uiAuditSave();
    save.character = { ...save.character, hp: 1_000, equippedBloodlineId: CUSTOM_ID };
    save.savedBloodlines = [{
        id: CUSTOM_ID,
        name: "Branks Pegger",
        rank: "A Rank",
        specialElement: "Wood",
        jutsus: [],
        totalPoints: 0,
    }];
    return save;
}

// Exact HP from the HUD tooltip ("HP 1,234/9,000"): the left card on desktop,
// the status bar on phones.
async function hudHp(page: Page): Promise<number> {
    const title = await page.locator(".left-profile-stat[title^='HP '], .mthd-bar-hp[title^='HP ']")
        .filter({ visible: true }).first().getAttribute("title");
    return Number(String(title).replace(/^HP\s*/, "").split("/")[0].replace(/[^\d]/g, ""));
}

// Walk the wizard (details, one step per jutsu) to its final review step, where
// the archive and the Awaken button live. The screen is lazy-loaded, so wait for
// the wizard before counting its steps.
async function openReviewStep(page: Page) {
    const next = page.locator(".bloodline-wizard-next");
    await expect(next).toBeVisible();
    for (let step = 0; step < 12 && await next.count() > 0; step += 1) await next.click();
    await expect(next).toHaveCount(0);
    await expect(page.locator(".bloodline-awakening-save")).toBeVisible();
}

test("an archive swap after a slow confirm keeps the regen earned meanwhile", async ({ page }) => {
    const runtime = await installUiAuditRuntime(page, lowHpSave());
    const postedHp: number[] = [];
    page.on("request", (request) => {
        if (request.method() !== "POST" || !request.headers()["x-bloodline-equip-intent"]) return;
        postedHp.push(Number((request.postDataJSON() as UiAuditSave).character?.hp));
    });
    await expectUiAuditBoot(page, runtime, "bloodlineMaker");
    await openReviewStep(page);

    const original = page.locator(".bloodline-awakening-saved-card").filter({ hasText: "Original bloodline" });
    await original.getByRole("button", { name: "Equip legacy" }).click();
    const confirm = page.getByRole("alertdialog", { name: "Swap bloodline" });
    await expect(confirm).toBeVisible();
    const atOpen = await hudHp(page);
    await expect.poll(() => hudHp(page), { timeout: 15_000 }).toBeGreaterThan(atOpen);
    const beforeEquip = await hudHp(page);
    await confirm.getByRole("button", { name: "Equip" }).click();

    await expect(original).toContainText("Equipped");
    expect(postedHp, "the swap should post the regenerated HP").toHaveLength(1);
    expect(postedHp[0]).toBeGreaterThanOrEqual(beforeEquip);
    expect(await hudHp(page), "the swap must not roll the HUD back").toBeGreaterThanOrEqual(beforeEquip);
});

test("a forge save keeps the regen earned while the save was in flight", async ({ page }) => {
    const save = lowHpSave();
    const character = { ...save.character, mythicSeals: 140, element: "Lightning", elements: ["Lightning"] };
    save.character = character;
    save.savedBloodlines = [];
    delete (save.character as Record<string, unknown>).equippedBloodlineId;
    const runtime = await installUiAuditRuntime(page, save);
    await page.route("**/api/bloodlines/forge", async (route) => {
        const result = applyBloodlineForgePurchase(character, [], "S Rank", randomUUID(), Date.now());
        if (!result.ok) return route.abort();
        const version = runtime.currentVersion() + 1;
        runtime.commitServerCharacter(result.character, version);
        await route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, rank: "S Rank",
            character: result.character, _saveVersion: version }) });
    });
    // Hold the forge's own save (it alone carries a write intent) until regen has ticked.
    const release = Promise.withResolvers<void>();
    let held = 0;
    await page.route("**/api/save/**", async (route) => {
        if (route.request().method() === "POST" && route.request().headers()["x-bloodline-write-intent"]) {
            held += 1;
            await release.promise;
        }
        await route.fallback();
    });

    await expectUiAuditBoot(page, runtime, "centralHub");
    await page.locator(".central-card").filter({ hasText: "Awakening Stone" }).click();
    await page.locator(".aw-forge-card.rank-s button").click();
    await expect(page.locator('.app-shell[data-screen="bloodlineMaker"]')).toBeVisible();
    await openReviewStep(page);

    const awaken = page.getByRole("button", { name: "Awaken Bloodline" });
    await expect(awaken).toBeEnabled();
    await awaken.click();
    await expect.poll(() => held).toBe(1);
    const atClick = await hudHp(page);
    await expect.poll(() => hudHp(page), { timeout: 15_000 }).toBeGreaterThan(atClick);
    const beforeAck = await hudHp(page);
    release.resolve();

    await expect(page.locator('.app-shell[data-screen="profile"]')).toBeVisible();
    expect(await hudHp(page), "the forge must not roll the HUD back").toBeGreaterThanOrEqual(beforeAck);
});
