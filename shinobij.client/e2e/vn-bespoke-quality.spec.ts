import { expect, test } from '@playwright/test';
import { installUiAuditRuntime, uiAuditSave } from './helpers/ui-audit-runtime';

// Certify the normal cinematic presentation separately from the deliberately
// Classic, reduced-motion narrative-memory fixtures.
test.use({ contextOptions: { reducedMotion: 'no-preference' } });

test('the default Stormveil introduction uses its bespoke cinematic art and stage', async ({ page, browserName }, info) => {
    test.skip(browserName !== 'chromium', 'Full-motion art review uses the Chromium desktop and touch projects.');
    const save = uiAuditSave();
    save.character = { ...save.character, storyProgress: 0, storyTraits: [] };
    await installUiAuditRuntime(page, save);
    await page.addInitScript(() => {
        localStorage.removeItem('vnReaderMode.v1');
        localStorage.setItem('vnTextSpeed.v1', 'instant');
        localStorage.setItem('vnAutoRead.v1', '0');
    });
    await page.goto('/#/village', { waitUntil: 'domcontentloaded' });
    const stage = page.locator('.cvn-root');
    await expect(stage).toBeVisible();
    await expect(stage).toContainText('The Challenge Board');
    await expect(page.locator('.visual-novel.admin-vn-play')).toHaveCount(0);
    await expect.poll(() => stage.evaluate(element => getComputedStyle(element).getPropertyValue('--cvn-background')))
        .toContain('/scenes/story/cinematic/storywide/stormveil-challenge-board-v1.webp');
    // Actor images are decorative; their figure caption supplies the name.
    const portrait = stage.locator('img[src*="/portraits/cinematic/storywide/mira-volt"]');
    await expect(portrait).toBeVisible();
    await expect(portrait).toHaveAttribute('src', /\/portraits\/cinematic\/storywide\/mira-volt(?:-neutral)?\.webp/);
    await expect.poll(() => portrait.evaluate(image => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth >= 512)).toBe(true);
    await expect.poll(async () => (await stage.boundingBox())?.width ?? 0).toBeGreaterThanOrEqual(page.viewportSize()!.width - 1);
    await page.screenshot({ path: info.outputPath('stormveil-bespoke-cinematic.png'), animations: 'disabled' });
});
