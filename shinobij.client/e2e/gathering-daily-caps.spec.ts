import { expect, test } from '@playwright/test';
import { expectUiAuditBoot, installUiAuditRuntime, uiAuditSave } from './helpers/ui-audit-runtime';
import { readResourceGathering } from '../../shared/resource-gathering';

for (const width of [1366, 390]) {
    test(`independent daily caps remain readable in the profile at ${width}px`, async ({ page }, info) => {
        await page.setViewportSize({ width, height: 900 });
        const day = new Date().toISOString().slice(0, 10), save = uiAuditSave();
        save.character = { ...save.character, serverExploreDate: day, serverExploresToday: 100,
            resourceGathering: { ...readResourceGathering(null), date: day, attemptsToday: 111,
                miningAttemptsToday: 49, fishingAttemptsToday: 50, harvestingAttemptsToday: 12 } };
        const runtime = await installUiAuditRuntime(page, save);
        await expectUiAuditBoot(page, runtime, 'profile');
        const you = page.locator('.mobile-bottom-nav').getByRole('button', { name: 'You', exact: true });
        if (width < 768) await you.click();
        const host = width < 768 ? page.getByRole('dialog', { name: 'Your shinobi' }) : page.locator('.left-profile-card');
        const caps = host.locator('.left-caps-grid');
        await expect(caps).toBeVisible();
        await expect(caps.locator('.left-caps-label')).toHaveText(['Explores', 'Missions', 'Mining', 'Fishing', 'Harvesting', 'Hunts', 'Reset In', 'Sealed Crates']);
        const cell = (label: string) => caps.locator('.left-caps-cell').filter({ has: page.locator('.left-caps-label', { hasText: new RegExp(`^${label}$`) }) });
        await expect(cell('Explores')).toContainText('100/100');
        await expect(cell('Mining')).toContainText('49/50');
        await expect(cell('Fishing')).toContainText('50/50');
        await expect(cell('Harvesting')).toContainText('12/50');
        // Every activity row wears a painted emblem from one set (Hunts' crossed
        // kunai), not a flat vector glyph or a borrowed terrain tile.
        const emblems = await caps.locator('.left-caps-label').evaluateAll(labels => labels.slice(0, 6).map(label => label.querySelector('img')?.getAttribute('src') ?? null));
        expect(emblems).toEqual(['/ui/icon-96/map.webp', '/ui/icon-96/scroll.webp', '/ui/icon-96/mining.webp',
            '/ui/icon-96/fishing.webp', '/ui/icon-96/harvesting.webp', '/ui/icon-96/attack.webp']);
        await expect.poll(async () => caps.locator('.left-caps-label img').evaluateAll(imgs => imgs.slice(0, 6).every(img => (img as HTMLImageElement).complete && (img as HTMLImageElement).naturalWidth > 0))).toBe(true);
        const colors = await caps.locator('.left-caps-value').evaluateAll(elements => elements.map(el => getComputedStyle(el).color));
        expect(colors[0]).toBe(colors[3]);
        expect(colors[2]).not.toBe(colors[3]);
        expect(await caps.evaluate(grid => Array.from(grid.querySelectorAll('.left-caps-label,.left-caps-value')).every(el => el.scrollWidth <= el.clientWidth + 1))).toBe(true);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
        await caps.screenshot({ path: info.outputPath(`daily-caps-${width}.png`) });
        await page.screenshot({ path: info.outputPath(`profile-caps-${width}.png`), fullPage: true });
    });
}
