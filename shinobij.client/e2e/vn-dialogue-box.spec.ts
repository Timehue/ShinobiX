import { expect, test, type Locator } from '@playwright/test';
import { installUiAuditRuntime, uiAuditSave } from './helpers/ui-audit-runtime';

// The typewriter is the state that used to shrink the box, and Reduce Motion
// skips it.
test.use({ contextOptions: { reducedMotion: 'no-preference' } });

const edges = async (box: Locator) => {
    const rect = (await box.boundingBox())!;
    return [rect.x, rect.y, rect.width, rect.height].map(Math.round).join(' ');
};

test('the story dialogue box holds one size through typing, Next and choices', async ({ page }) => {
    const save = uiAuditSave();
    save.triggeredEvents = (save.triggeredEvents as string[]).filter(id => id !== 'builtin-aura-sphere-lv9');
    await installUiAuditRuntime(page, save);
    await page.addInitScript(() => {
        localStorage.setItem('vnReaderMode.v1', 'cinematic');
        localStorage.setItem('vnTextSpeed.v1', 'normal');
        localStorage.setItem('vnAutoRead.v1', '0');
        localStorage.setItem('pet-music-muted', '1');
    });
    await page.goto('/#/village', { waitUntil: 'domcontentloaded' });
    const scene = page.getByRole('dialog', { name: 'A Timed Issue Seal visual novel scene', exact: true });
    const box = scene.locator('.cvn-dialogue-shell');
    await expect(box).toBeVisible();

    const first = await edges(box);
    const seen = new Set<string>();
    for (let step = 0; step < 40; step++) {
        if (!await box.isVisible()) break;
        if (await scene.locator('.cvn-caret').count()) seen.add('typing');
        expect(await edges(box)).toBe(first);
        const footer = scene.locator('.cvn-dialogue-footer');
        const action = footer.getByRole('button', { name: /^(Next|Continue)$/ });
        const choice = footer.locator('.vn-choice-btn').first();
        await expect(action.or(choice).first()).toBeVisible();
        expect(await edges(box)).toBe(first);
        if (await choice.isVisible()) {
            seen.add('choices');
            await expect(choice).toBeEnabled();
            expect(await edges(box)).toBe(first);
            await choice.click();
        } else {
            seen.add('next');
            await action.first().click();
        }
    }
    expect(seen.has('typing')).toBe(true);
    expect(seen.has('next')).toBe(true);
});
