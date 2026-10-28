import { expect, test, type Page } from '@playwright/test';
import { installUiAuditRuntime, uiAuditSave } from './helpers/ui-audit-runtime';
import { reloadWithTransientAssetRecovery } from './helpers/navigation-reload';
import { collectNavigationPageErrors } from './helpers/navigation-page-errors';

// These navigation fixtures contain no AI fight. A painted route is ready for
// Back only after the initial saved-fight probe commits its empty release.
const screen = (page: Page, name: string) => page.locator(`.app-shell[data-screen="${name}"][data-sealed-fight-engaged="false"]`);
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
    await reloadWithTransientAssetRecovery(page, () => expect(screen(page, 'pvpBattle')).toBeVisible());
}

test('Back and Forward follow screens; refresh retains the Back destination', async ({ page, browserName }) => {
    const { errors } = collectNavigationPageErrors(page, browserName);
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
    await reloadWithTransientAssetRecovery(page, () => expect(screen(page, 'inventory')).toBeVisible());
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
    await reloadWithTransientAssetRecovery(page, () => expect(screen(page, 'home')).toBeVisible());
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
    // The selected tab paints before its passive persistence effect completes.
    // Confirm the preference is durable before deliberately replacing the document.
    await expect.poll(() => page.evaluate(() => sessionStorage.getItem('arenaTab.v1:auditninja:district')),
        { message: 'the recovered spectator tab is persisted before reload' }).toBe('spectate');
    await reloadWithTransientAssetRecovery(page, () => expect(screen(page, 'arenaDistrict')).toBeVisible());
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
    await reloadWithTransientAssetRecovery(page, () => expect(screen(page, 'pvpBattle')).toBeVisible());
});


test('WebKit reload cancellations retain genuine page errors', async ({ page, browserName }) => {
    test.skip(browserName !== 'webkit', 'Exercises WebKit document-replacement fetch cancellation');
    const replacementStarted = Promise.withResolvers<void>();
    const releaseReplacement = Promise.withResolvers<void>();
    let visits = 0;
    let dispatchedProbes = 0;
    await page.route('**/__navigation-reload-regression__', async route => {
        if (++visits > 1) {
            replacementStarted.resolve();
            await releaseReplacement.promise;
        }
        await route.fulfill({ contentType: 'text/html', body: '<!doctype html><h1>Navigation fixture</h1>' });
    });
    await page.route('**/api/pvp/session?*', async route => {
        dispatchedProbes++;
        await route.fulfill({ status: 204 });
    });
    const captured = collectNavigationPageErrors(page, browserName);
    await page.goto('/__navigation-reload-regression__');
    const reload = page.reload();
    try {
        await replacementStarted.promise;
        // Force the original race: an old-document retry starts after the
        // replacement request, before commit. Its rejection is already caught.
        await page.evaluate(() => {
            void fetch('/api/pvp/session?pending=1&playerName=AuditNinja&recoveryProbeVersion=2').catch(() => {});
        });
        await expect.poll(() => captured.documentReplacementErrors.length).toBe(1);
        expect(dispatchedProbes).toBe(0);
        expect(captured.errors).toEqual([]);
    } finally {
        releaseReplacement.resolve();
        await reload;
    }
    await expect(page.getByRole('heading', { name: 'Navigation fixture' })).toBeVisible();
    await page.evaluate(() => {
        setTimeout(() => { throw new Error('navigation regression sentinel'); }, 0);
    });
    await expect.poll(() => captured.errors).toEqual(['navigation regression sentinel']);
    captured.dispose();
});
