import { expect, test } from '@playwright/test';
import { installUiAuditRuntime, uiAuditSave } from './helpers/ui-audit-runtime';

test('the Village Elder keeps his head, raised hand and seal inside the scene', async ({ page }, info) => {
    const save = uiAuditSave();
    save.triggeredEvents = (save.triggeredEvents as string[]).filter(id => id !== 'builtin-aura-sphere-lv9');
    await installUiAuditRuntime(page, save);
    await page.addInitScript(() => {
        localStorage.setItem('vnReaderMode.v1', 'cinematic');
        localStorage.setItem('vnTextSpeed.v1', 'instant');
        localStorage.setItem('vnAutoRead.v1', '0');
        localStorage.setItem('pet-music-muted', '1');
    });
    await page.goto('/#/village', { waitUntil: 'domcontentloaded' });
    const scene = page.getByRole('dialog', { name: 'A Timed Issue Seal visual novel scene', exact: true });
    await expect(scene).toBeVisible();
    const actor = scene.locator('.cvn-actor.is-speaking');
    const portrait = actor.locator('img');
    await expect(portrait).toHaveAttribute('src', /\/side-stories\/village-elder\.webp/);
    await expect.poll(() => portrait.evaluate(image => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0)).toBe(true);
    await expect(actor).toHaveCSS('opacity', '1');
    await page.screenshot({ path: info.outputPath('village-elder.png'), animations: 'disabled' });

    const image = (await portrait.boundingBox())!;
    const frame = (await actor.locator('.cvn-portrait-frame').boundingBox())!;
    const viewport = (await scene.boundingBox())!;
    const title = (await scene.locator('.cvn-topbar').boundingBox())!;
    const dialogue = (await scene.locator('.cvn-dialogue-shell').boundingBox())!;
    // Check the artwork itself, not just its smaller layout box: the old torso
    // crop let the image overflow that box and hid the raised hand offscreen.
    expect(image.x).toBeGreaterThanOrEqual(viewport.x + 4);
    expect(image.x + image.width).toBeLessThanOrEqual(viewport.x + viewport.width - 4);
    expect(image.y).toBeGreaterThanOrEqual(title.y + title.height + 4);
    // Both hands and the seal occupy the upper 40% of this source. Desktop
    // deliberately lets the robe continue behind the dialogue glass.
    expect(image.y + image.height * .4).toBeLessThanOrEqual(dialogue.y);
    if (viewport.width <= 800 && viewport.height > viewport.width) {
        expect(frame.y + frame.height).toBeLessThanOrEqual(dialogue.y);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
