import { expect, test } from '@playwright/test';
import { expectViewportSafe } from './helpers/adaptive-assertions';

for (const seal of [0, 1, 2]) test(`dungeon seal ${seal + 1} presents readable dialogue and actions`, async ({ page }, info) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
        localStorage.setItem('vnTextSpeed.v1', 'instant');
        localStorage.setItem('pet-music-muted', '1');
        localStorage.setItem('vnAutoRead.v1', '0');
    });
    await page.route('**/api/**', route => route.fulfill({ json: { ok: false, error: 'Isolated presentation preview' } }));
    await page.goto(`/?preview=vn&reader=dungeon&event=builtin-hidden-dungeon&page=${seal}&dungeonArt=1`);
    const stage = page.locator('.cvn-root');
    await expect(stage).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('.cvn-dialogue-footer button').first()).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    await expect.poll(() => stage.locator('img').evaluateAll(images => images.every(image =>
        (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0))).toBe(true);
    await expectViewportSafe(page);
    await page.screenshot({ path: info.outputPath(`dungeon-seal-${seal + 1}.png`), animations: 'disabled' });
    expect(errors).toEqual([]);
});
