import { expect, test } from '@playwright/test';
import { installUiAuditRuntime, uiAuditSave } from './helpers/ui-audit-runtime';
import { quietRoadCooldowns } from '../e2e-live/helpers/quiet-road';
import { expectMapNoticeTextSeparated } from './helpers/map-notice-geometry';

test('compact map notice separates Study and lesson glyphs in the actual app', async ({ page }, info) => {
    test.setTimeout(120_000);
    const save = uiAuditSave(); save.currentSector = 1; save.currentTile = 78; save.worldGeoV = 2;
    save.character = { ...save.character, level: 40, pets: [{ id: 'layout-pet', templateId: 'rare-26', name: 'Kuro', element: 'Fire', rarity: 'rare', level: 45, xp: 0, maxLevel: 100, hp: 420, attack: 72, defense: 58, speed: 64, jutsus: [], unlockedForPve: true, trait: 'Loyal', happiness: 88, origin: 'wild', generation: 0, breedingUsesMax: 8, breedingUsesRemaining: 8 }], wandererCooldowns: quietRoadCooldowns(Array.from({ length: 65 }, (_, i) => i + 1)) };
    await installUiAuditRuntime(page, save);
    await page.addInitScript(() => localStorage.setItem('legacyRumors.seen.v1:auditninja', JSON.stringify([10, 20, 30, 40, 45])));
    await page.goto('/#/worldMap');
    await expect(page.locator('.app-shell')).toHaveAttribute('data-screen', 'worldMap');
    const back = page.getByRole('button', { name: /Return to Sector 1/ });
    await expect.poll(async () => await back.isVisible() || await page.locator('.sector-image-map').isVisible()).toBe(true);
    if (await back.isVisible()) await back.click();
    const banner = page.locator('.pet-mentor-road-prompt');
    await expect(banner).toBeVisible();
    for (const [width, height] of [[568, 320], [667, 375], [844, 390], [320, 568], [390, 844], [1366, 768]]) {
        await page.setViewportSize({ width, height });
        await expectMapNoticeTextSeparated(banner, `${width}x${height}`);
        await page.screenshot({ path: info.outputPath(`compact-notice-${width}x${height}.png`), fullPage: true });
        await page.getByRole('button', { name: 'Collapse field lesson notice' }).click();
        await expect(page.getByRole('button', { name: 'Expand field lesson notice' })).toBeFocused();
        await page.getByRole('button', { name: 'Expand field lesson notice' }).press('Enter');
        await expect(banner.locator('.pet-mentor-road-action')).toBeVisible();
    }
});

test('compact map notice separates text at narrow container widths', async ({ page }, info) => {
    await page.goto('/e2e/fixtures/compact-map-notice.html');
    const banner = page.locator('.pet-mentor-road-prompt');
    for (const width of [180, 186, 200, 220, 260, 400]) {
        await page.locator('.map-instance').evaluate((element, width) => { element.style.width = `${width}px`; }, width);
        await expectMapNoticeTextSeparated(banner, `map width ${width}px`);
        await page.screenshot({ path: info.outputPath(`compact-container-${width}.png`) });
    }
});
