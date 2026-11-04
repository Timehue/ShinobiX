import { expect, test } from "@playwright/test";
import { expectUiAuditBoot, installUiAuditRuntime, uiAuditSave } from "./helpers/ui-audit-runtime";

// Phones draw menus at 85% (src/lib/mobile-ui-scale.ts) while combat, the card
// game and the World Map hold full scale. Chrome saves the page zoom when it
// unloads and restores it on reload, so a reload on a held screen briefly shows
// 1.0 over the 85% layout until the hold rewrites the meta. The next menu must
// come back at 85% and fit: neither cut off at 1.0 nor given up to a 1.0 layout.
test("a reload on a full-scale screen brings the next menu back at 85% and uncut", async ({ page }, testInfo) => {
    test.skip(!["chromium-mobile", "chromium-compact"].includes(testInfo.project.name), "the 85% phone scale runs on Chromium phones only");
    const runtime = await installUiAuditRuntime(page, uiAuditSave());
    await expectUiAuditBoot(page, runtime, "worldMap");
    await expect.poll(() => page.evaluate(() => Math.round(window.visualViewport!.scale * 100))).toBe(100);

    await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator('.app-shell[data-screen="worldMap"]').waitFor({ state: "visible" });
    // Leave through the game's own nav, as a player would: a hash-only goto is
    // ignored by the app's history handler and never changes the screen.
    await page.locator('.mobile-bottom-nav [data-tabletop-command="items"]').click();
    await page.locator('.app-shell[data-screen="inventory"]').waitFor({ state: "visible" });

    await expect.poll(() => page.evaluate(() => Math.round(window.visualViewport!.scale * 100)), { timeout: 5_000 }).toBe(85);
    // Hold it past the moment a "zoom is stuck" guard would have judged it.
    await page.waitForTimeout(1_000);
    expect(await page.evaluate(() => Math.round(window.visualViewport!.scale * 100))).toBe(85);
    // The visible area covers the whole layout.
    expect(await page.evaluate(() => {
        const viewport = window.visualViewport!;
        return Math.ceil(viewport.width) >= document.documentElement.clientWidth;
    })).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        await page.evaluate(() => Math.ceil(window.visualViewport!.width)),
    );
});
