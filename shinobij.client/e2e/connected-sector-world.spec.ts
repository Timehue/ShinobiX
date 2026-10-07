import { expect, test, type Page } from '@playwright/test';
import { installUiAuditRuntime, uiAuditSave } from './helpers/ui-audit-runtime';
import { sectorExits, SECTOR_POINTS } from '../../shared/sector-links';
import { sectorName } from '../../shared/sector-geo';
import { nearestWalkableTile } from '../../shared/sector-walk-mask';
import { quietRoadCooldowns } from '../e2e-live/helpers/quiet-road';

// The accepted board-pan suite is archived in output/continuous-world-20261007.
// These are responsive/input checks; the live suite checks real server admission,
// and shared navigation tests exercise all 186 directed roads.
async function boot(page: Page, sector: number, tile: number, village = 'Stormveil Village') {
    const save = uiAuditSave(); save.currentSector = sector; save.currentTile = tile; save.worldGeoV = 2;
    save.character = { ...save.character, village, storyVillage: village, wandererCooldowns: quietRoadCooldowns(Array.from({ length: 65 }, (_, i) => i + 1)) };
    save.triggeredEvents = (save.triggeredEvents as string[]).map(event => event.replace('stormveil-village', village.toLowerCase().replace(/\s+/g, '-')));
    await installUiAuditRuntime(page, save);
    await page.addInitScript(() => localStorage.setItem('legacyRumors.seen.v1:auditninja', JSON.stringify([10, 20, 30, 40, 45])));
    await page.goto('/#/worldMap');
    await expect(page.locator('.app-shell')).toHaveAttribute('data-screen', 'worldMap');
    const here = sector === 99 ? page.getByRole('button', { name: `You are here, ${sectorName(sector)}`, exact: true })
        : page.getByRole('button', { name: new RegExp('Return to Sector ' + sector) });
    await expect.poll(async () => await here.isVisible() || await page.locator('.sector-image-map').isVisible()).toBe(true);
    if (await here.isVisible()) await here.click();
    await expect(page.locator('.pixel-map[data-ground-floor="true"]').first()).toBeVisible();
    if (sector !== 99) await expect(page.locator('.continuous-world-map')).toHaveAttribute('aria-busy', 'false');
}

for (const direction of ['north', 'east', 'south', 'west'] as const) test(`the camera follows a ${direction} road through its invisible sector boundary`, async ({ page }, info) => {
    test.setTimeout(120_000);
    const exit = [...sectorExits(31), ...SECTOR_POINTS.flatMap(p => sectorExits(p.id))].find(e => e.direction === direction)!;
    await boot(page, exit.sector, nearestWalkableTile(exit.sector, 78));
    const canvas = page.locator('.continuous-world-map > canvas');
    await expect(canvas).toHaveAttribute('data-world-sector', String(exit.sector));
    const road = page.getByRole('button', { name: `Cross to ${sectorName(exit.destinationSector)}`, exact: true });
    await road.focus(); await road.press('Enter');
    await expect(canvas).toHaveAttribute('data-world-sector', String(exit.destinationSector), { timeout: 90_000 });
    await expect(page.locator('[data-world-self]')).toHaveCount(1);
    await expect(page.locator('.sector-floor-outgoing,.sector-gate-svg')).toHaveCount(0);
    expect(Number(await canvas.getAttribute('data-decoded-maps'))).toBeLessThanOrEqual(4);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`continuous-${direction}.png`), fullPage: true });
});

test('holding a key moves continuously and Escape cancels a route', async ({ page }) => {
    await boot(page, 9, 102, 'Ashen Leaf Village');
    const canvas = page.locator('.continuous-world-map > canvas'); await canvas.focus();
    const x = Number(await canvas.getAttribute('data-world-x'));
    await page.keyboard.down('d');
    await expect.poll(async () => Number(await canvas.getAttribute('data-world-x'))).toBeGreaterThan(x + .4);
    await page.keyboard.up('d'); await page.keyboard.press('Escape');
    let previous = '';
    await expect.poll(async () => { const next = `${await canvas.getAttribute('data-world-x')}:${await canvas.getAttribute('data-world-y')}`;
        const stopped = next === previous; previous = next; return stopped; }, { intervals: [300] }).toBe(true);
    await expect(page.locator('[data-world-self].is-walking')).toHaveCount(0);
});
test('an old saved position inside a building initializes on accessible ground', async ({ page }) => {
    await boot(page, 31, 86);
    await expect(page.getByRole('button', { name: 'Current tile row 7 column 3', exact: true })).toBeVisible();
});
test('members can enter the centered village', async ({ page }) => {
    await boot(page, 9, 102, 'Ashen Leaf Village');
    const entrance = page.getByRole('button', { name: 'Enter Ashen Leaf Village', exact: true });
    await expect(entrance).toBeEnabled(); await entrance.click();
    await expect(page.getByRole('heading', { name: 'Ashen Leaf Village', exact: true })).toBeVisible();
});
test('the centered village entrance preserves its membership restriction', async ({ page }) => {
    await boot(page, 9, 102);
    await expect(page.getByRole('button', { name: 'Ashen Leaf Village — village members only', exact: true })).toBeDisabled();
});
test('Death’s Gate retains its isolated painted arena and blocked lava', async ({ page }) => {
    await boot(page, 99, 53);
    await expect(page.locator('.continuous-world-map')).toHaveCount(0);
    await expect(page.locator('.sector-ground-stronghold')).toHaveText('Obsidian Stronghold');
    await expect(page.getByRole('button', { name: 'Move near blocked tile row 9 column 1', exact: true })).toBeEnabled();
});
