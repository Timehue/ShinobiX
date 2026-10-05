import { expect, test, type Page } from '@playwright/test';
import { installUiAuditRuntime, uiAuditSave } from './helpers/ui-audit-runtime';

const screen = (page: Page, name: string) => page.locator(`.app-shell[data-screen="${name}"]`);
test.beforeEach(async ({ page }) => {
    // The static preview has no realtime server. Return an explicit unavailable
    // response so WebKit does not report a cancelled fallback request as a CORS
    // page error during reload; transport behavior has separate real-server tests.
    await page.route('**/socket.io/**', route => route.fulfill({
        status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Realtime unavailable in navigation fixture' }),
    }));
});
async function navigateFromMenu(page: Page, name: string) {
    const mobileMenu = page.getByRole('navigation', { name: 'Primary game navigation' })
        .getByRole('button', { name: /^Menu\b/ });
    const destination = page.getByRole('button', { name, exact: true }).filter({ visible: true }).first();
    // The shell can render before lazy navigation labels finish loading. Wait
    // for either real control before choosing the desktop or mobile path.
    await expect(mobileMenu.or(destination).first()).toBeVisible();
    if (await mobileMenu.isVisible()) {
        await mobileMenu.click();
        await page.getByRole('dialog', { name: 'Shinobi menu' })
            .getByRole('button', { name, exact: true }).click();
    } else {
        await destination.click();
    }
}

test('Back and Forward follow screens; refresh retains the Back destination', async ({ page, browserName }, testInfo) => {
    const errors: string[] = [];
    const reloadDiagnostics: string[] = [];
    let replacingDocument = false;
    page.on('pageerror', error => {
        // WebKit emits this native diagnostic when reload cancels a same-origin
        // fetch, including rejections caught by the app. Keep it in the report;
        // all JS exceptions, other origins, and errors outside reload still fail.
        if (browserName === 'webkit' && replacingDocument
            && error.name === 'Fetch API cannot load http'
            && error.message.startsWith(`/${new URL(page.url()).host}/`)
            && error.message.endsWith(' due to access control checks.')) {
            reloadDiagnostics.push(error.message);
        } else errors.push(error.message);
    });
    await installUiAuditRuntime(page, { ...uiAuditSave(), currentSector: 0 });
    await page.goto('/#/village');
    await expect(screen(page, 'village')).toBeVisible();
    await navigateFromMenu(page, 'Training');
    await expect(screen(page, 'training')).toBeVisible();
    await navigateFromMenu(page, 'Inventory');
    await expect(screen(page, 'inventory')).toBeVisible();
    await page.goBack();
    await expect(screen(page, 'training')).toBeVisible();
    await page.goForward();
    await expect(screen(page, 'inventory')).toBeVisible();
    replacingDocument = true;
    try { await page.reload(); } finally { replacingDocument = false; }
    await expect(screen(page, 'inventory')).toBeVisible();
    await page.goBack();
    await expect(screen(page, 'training')).toBeVisible();
    await page.getByRole('button', { name: /back/i }).filter({ visible: true }).first().click();
    await expect(screen(page, 'village')).toBeVisible();
    if (reloadDiagnostics.length) await testInfo.attach('webkit-reload-diagnostics', {
        body: JSON.stringify(reloadDiagnostics, null, 2), contentType: 'application/json',
    });
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
    await navigateFromMenu(page, 'Pet Home');
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
        if (sessionStorage.getItem('spectator-origin-fixture')) return;
        sessionStorage.setItem('spectator-origin-fixture', '1');
        sessionStorage.setItem('navigation.v1:auditninja', JSON.stringify({ screen: 'arenaDistrict', trail: ['arenaDistrict'] }));
    });
    await page.route('**/api/pvp/session?*', route => route.fulfill({ status: 503, json: { error: 'Temporarily unavailable' } }));
    await page.route('**/api/pvp/spectate?*', async route => {
        if (route.request().method() === 'POST' && route.request().postDataJSON().action === 'leave') leaves.push(route.request().postDataJSON());
        await route.fulfill({ json: { spectators: [] } });
    });
    // Seed recovery from a loaded origin so Back traverses a real prior screen.
    await page.goto('/#/arenaDistrict');
    await expect(screen(page, 'arenaDistrict')).toBeVisible();
    await expect(page).toHaveURL(/#\/arenaDistrict$/);
    // The shell paints before lazy profile CSS and arena controls are ready.
    // Verify the loaded origin before reload can cancel an unfinished preload.
    await expect(page.locator('.left-profile-card')).toHaveCount(1);
    await expect(screen(page, 'arenaDistrict').getByRole('button', { name: 'Spectate', exact: true })).toBeVisible();
    await page.evaluate(() => {
        localStorage.setItem('pvpSession.v1', JSON.stringify({ owner: 'auditninja', pvpBattleId: 'spectator-fixture', pvpRole: 'p1', pvpBattleContext: { spectatingFromScreen: 'arenaDistrict' }, savedAt: Date.now() }));
        const stack = history.state.shinobiNavigation.stack;
        history.pushState({ shinobiNavigation: { account: 'AuditNinja', stack: [...stack, 'pvpBattle'] } }, '', '#/pvpBattle');
    });
    // Account restoration can replace the hash during load. Wait for the new
    // document, then assert the recovered screen and its action are ready.
    await page.reload({ waitUntil: 'commit' });
    await expect(screen(page, 'pvpBattle')).toBeVisible();
    // The shell is visible before the recovered spectator screen is ready.
    await expect(page.getByRole('button', { name: 'Stop watching', exact: true })).toBeVisible();
    if (exit === 'browser Back') await page.goBack();
    else await page.getByRole('button', { name: 'Stop watching', exact: true }).click();
    await expect(screen(page, 'arenaDistrict')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Spectate', exact: true })).toHaveClass(/active/);
    await expect.poll(() => leaves.length).toBeGreaterThan(0);
    expect(await page.evaluate(() => localStorage.getItem('pvpSession.v1'))).toBeNull();
    await expect(page).toHaveURL(/#\/arenaDistrict$/);
    await page.reload({ waitUntil: 'commit' });
    await expect(screen(page, 'arenaDistrict')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Spectate', exact: true })).toHaveClass(/active/);
});

test('a recovered participant cannot use browser Back to abandon an unresolved fight', async ({ page }) => {
    await installUiAuditRuntime(page, { ...uiAuditSave(), currentSector: 0 });
    await page.route('**/api/pvp/session?*', route => route.fulfill({ status: 503, json: { error: 'Temporarily unavailable' } }));
    await page.goto('/#/village');
    await navigateFromMenu(page, 'Inventory');
    await expect(screen(page, 'inventory')).toBeVisible();
    await expect(page).toHaveURL(/#\/inventory$/);
    await page.evaluate(() => {
        localStorage.setItem('pvpSession.v1', JSON.stringify({ owner: 'auditninja', pvpBattleId: 'participant-fixture', pvpRole: 'p1', pvpBattleContext: { mode: 'ranked' }, savedAt: Date.now() }));
        const stack = history.state.shinobiNavigation.stack;
        history.pushState({ shinobiNavigation: { account: 'AuditNinja', stack: [...stack, 'pvpBattle'] } }, '', '#/pvpBattle');
    });
    await page.reload();
    await expect(screen(page, 'pvpBattle')).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL(/#\/pvpBattle$/);
    await expect(screen(page, 'pvpBattle')).toBeVisible();
    await page.reload();
    await expect(screen(page, 'pvpBattle')).toBeVisible();
});
