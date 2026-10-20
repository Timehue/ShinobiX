import { test, expect } from '@playwright/test';
import { installUiAuditRuntime, uiAuditSave } from './helpers/ui-audit-runtime';

for (const width of [1366, 390]) {
    test(`stat cards and Add buttons stay inside their groups at ${width}px`, async ({ page }, info) => {
        await page.setViewportSize({ width, height: 900 });
        const save = uiAuditSave();
        save.character = { ...save.character, unspentStats: 200, stats: { ...save.character.stats, willpower: 10 } };
        await installUiAuditRuntime(page, save);
        await page.goto('/#/profile', { waitUntil: 'domcontentloaded' });
        await page.locator('.profile-mobile-tabs').getByRole('button', { name: 'Stats', exact: true }).click();
        const groups = page.locator('.profile-page-card .stat-group');
        await expect(groups).toHaveCount(3);
        const overflow = await groups.evaluateAll(elements => elements.flatMap(group => {
            const bounds = group.getBoundingClientRect();
            return Array.from(group.querySelectorAll('.stat-card')).filter(card => {
                const rect = card.getBoundingClientRect();
                return rect.left < bounds.left - 1 || rect.right > bounds.right + 1;
            }).map(card => card.textContent);
        }));
        expect(overflow).toEqual([]);
        await page.getByRole('spinbutton', { name: 'Points to add to Willpower', exact: true }).fill('10');
        await page.getByRole('button', { name: 'Add selected points to Willpower', exact: true }).click();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
        await page.screenshot({ path: info.outputPath(`stat-allocation-${width}.png`), fullPage: true });
    });
}
