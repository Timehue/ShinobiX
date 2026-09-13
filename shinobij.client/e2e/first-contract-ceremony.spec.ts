import { expect, test } from '@playwright/test';
import { installUiAuditRuntime, uiAuditSave } from './helpers/ui-audit-runtime';

test('illustrated first-contract cards remain usable in the Academy return ceremony', async ({ page }, testInfo) => {
    test.setTimeout(90_000);
    const save = uiAuditSave();
    await installUiAuditRuntime(page, {
        ...save,
        currentSector: 0,
        character: {
            ...save.character,
            onboardingStep: 'sectorReturn',
            academyVow: 'unbound',
            academySectorVisited: true,
            academyFieldSeal: true,
        },
    });
    await page.goto('/#/village', { waitUntil: 'networkidle' });
    const ceremony = page.getByRole('dialog', { name: 'Your next step is yours.' });
    await expect(ceremony).toBeVisible();
    await expect(ceremony.locator('.fc-route-art')).toHaveCount(3);
    await expect.poll(() => ceremony.locator('.fc-route-art').evaluateAll((images) =>
        images.every((image) => image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0))).toBe(true);
    const panel = ceremony.locator('.asm-ceremony');
    expect(await panel.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
    await panel.evaluate((el) => { el.scrollTop = 0; });
    await expect(ceremony.getByRole('heading', { name: 'Your next step is yours.' })).toBeInViewport({ ratio: 1 });
    await page.screenshot({ path: testInfo.outputPath('first-contract-ceremony.png') });
    const stay = ceremony.getByRole('button', { name: 'Stay in the village for now' });
    await stay.scrollIntoViewIfNeeded();
    await expect(stay).toBeInViewport({ ratio: 1 });
});
