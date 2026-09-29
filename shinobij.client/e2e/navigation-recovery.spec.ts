import { expect, test, type Page } from '@playwright/test';
import { installUiAuditRuntime, uiAuditSave } from './helpers/ui-audit-runtime';

const screen = (page: Page, name: string) => page.locator(`.app-shell[data-screen="${name}"]`);
async function openMenuScreen(page: Page, name: string) {
    const target = page.getByRole('button', { name, exact: true }).filter({ visible: true }).first();
    const menu = page.getByRole('button', { name: 'Menu', exact: true }).filter({ visible: true }).first();
    await expect(target.or(menu).first()).toBeVisible();
    if (!await target.isVisible()) await menu.click();
    await target.click();
}

// Seed a previously visited route after a user gesture, then really reload it.
// Firefox skips history entries synthesized before the document first loads.
async function restoreBattleHistory(page: Page, origin: string) {
    await page.getByRole('heading', { name: 'PvP Battle', exact: true }).click();
    await page.evaluate(origin => {
        history.replaceState({ shinobiNavigation: { account: 'AuditNinja', stack: [origin] } }, '', '#/' + origin);
        history.pushState({ shinobiNavigation: { account: 'AuditNinja', stack: [origin, 'pvpBattle'] } }, '', '#/pvpBattle');
    }, origin);
    await page.reload();
    await expect(screen(page, 'pvpBattle')).toBeVisible();
}

test('Back and Forward follow screens; refresh retains the Back destination', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await installUiAuditRuntime(page, { ...uiAuditSave(), currentSector: 0 });
    await page.goto('/#/village');
    await expect(screen(page, 'village')).toBeVisible();
    await openMenuScreen(page, 'Training');
    await expect(screen(page, 'training')).toBeVisible();
    await openMenuScreen(page, 'Inventory');
    await expect(screen(page, 'inventory')).toBeVisible();
    await page.goBack();
    await expect(screen(page, 'training')).toBeVisible();
    await page.goForward();
    await expect(screen(page, 'inventory')).toBeVisible();
    await page.reload();
    await expect(screen(page, 'inventory')).toBeVisible();
    await page.goBack();
    await expect(screen(page, 'training')).toBeVisible();
    await page.getByRole('button', { name: /back/i }).filter({ visible: true }).first().click();
    await expect(screen(page, 'village')).toBeVisible();
    expect(errors).toEqual([]);
});

test('Pet Home remembers a field origin after refresh', async ({ page }, testInfo) => {
    const frames: Array<{ sector: number; enterTown: boolean }> = [];
    await installUiAuditRuntime(page, { ...uiAuditSave(), currentSector: 13, currentTile: 44 });
    await page.route('**/api/player/heartbeat', async route => {
        frames.push(route.request().postDataJSON());
        await route.fulfill({ json: { sector: 13, tile: 44, traveling: false, sectorMates: [], pendingChallenges: [], pendingNotices: [] } });
    });
    await page.goto('/#/worldMap');
    await expect(screen(page, 'worldMap')).toBeVisible();
    await openMenuScreen(page, 'Pet Home');
    await expect(screen(page, 'home')).toBeVisible();
    await page.reload();
    await expect(screen(page, 'home')).toBeVisible();
    await page.getByRole('button', { name: 'Back to World Map', exact: true }).click();
    await expect(screen(page, 'worldMap')).toBeVisible();
    await expect(page.locator('.sector-hud-region')).toContainText('Sector 13');
    await expect(page.getByRole('button', { name: 'Current tile row 4 column 9' })).toHaveCount(1);
    expect(frames.every(frame => !frame.enterTown)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath('returned-to-field.png') });
});

test('a refreshed transient profile returns to its origin instead of an unrelated hub', async ({ page }) => {
    await installUiAuditRuntime(page, { ...uiAuditSave(), currentSector: 0 });
    await page.addInitScript(() => sessionStorage.setItem('navigation.v1:auditninja', JSON.stringify({ screen: 'userView', trail: ['village', 'tavern'] })));
    await page.goto('/#/userView');
    await expect(screen(page, 'tavern')).toBeVisible();
});

for (const exit of ['Stop watching', 'browser Back'] as const) test(`leaving a recovered spectator view with ${exit} clears its breadcrumb and returns to the spectator board`, async ({ page }) => {
    const leaves: unknown[] = [];
    await installUiAuditRuntime(page, { ...uiAuditSave(), currentSector: 0 });
    await page.addInitScript(() => {
        if (sessionStorage.getItem('spectator-fixture')) return;
        sessionStorage.setItem('spectator-fixture', '1');
        localStorage.setItem('pvpSession.v1', JSON.stringify({ owner: 'auditninja', pvpBattleId: 'spectator-fixture', pvpRole: 'p1', pvpBattleContext: { spectatingFromScreen: 'arenaDistrict' }, savedAt: Date.now() }));
    });
    await page.route('**/api/pvp/session?*', route => route.fulfill({ status: 503, json: { error: 'Temporarily unavailable' } }));
    await page.route('**/api/pvp/spectate?*', async route => {
        if (route.request().method() === 'POST' && route.request().postDataJSON().action === 'leave') leaves.push(route.request().postDataJSON());
        await route.fulfill({ json: { spectators: [] } });
    });
    await page.goto('/#/pvpBattle');
    await expect(screen(page, 'pvpBattle')).toBeVisible();
    await restoreBattleHistory(page, 'arenaDistrict');
    if (exit === 'browser Back') await page.goBack();
    else await page.getByRole('button', { name: 'Stop watching', exact: true }).click();
    await expect(screen(page, 'arenaDistrict')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Spectate', exact: true })).toHaveClass(/active/);
    await expect.poll(() => leaves.length).toBeGreaterThan(0);
    expect(await page.evaluate(() => localStorage.getItem('pvpSession.v1'))).toBeNull();
    await page.reload();
    await expect(screen(page, 'arenaDistrict')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Spectate', exact: true })).toHaveClass(/active/);
});

test('a recovered participant cannot use browser Back to abandon an unresolved fight', async ({ page }) => {
    await installUiAuditRuntime(page, { ...uiAuditSave(), currentSector: 0 });
    await page.addInitScript(() => {
        localStorage.setItem('pvpSession.v1', JSON.stringify({ owner: 'auditninja', pvpBattleId: 'participant-fixture', pvpRole: 'p1', pvpBattleContext: { mode: 'ranked' }, savedAt: Date.now() }));
    });
    await page.route('**/api/pvp/session?*', route => route.fulfill({ status: 503, json: { error: 'Temporarily unavailable' } }));
    await page.goto('/#/pvpBattle');
    await expect(screen(page, 'pvpBattle')).toBeVisible();
    await restoreBattleHistory(page, 'inventory');
    await page.goBack();
    await expect(page).toHaveURL(/#\/pvpBattle$/);
    await expect(screen(page, 'pvpBattle')).toBeVisible();
    await page.reload();
    await expect(screen(page, 'pvpBattle')).toBeVisible();
});
