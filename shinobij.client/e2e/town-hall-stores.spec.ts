import { expect, test, type Page, type Route } from '@playwright/test';
import { expectUiAuditBoot, installUiAuditRuntime, uiAuditSave } from './helpers/ui-audit-runtime';

const village = 'Stormveil Village';
const storesRow = (page: Page, label = 'Materials') => page.locator('.town-store-row').filter({ has: page.getByText(`${label}:`, { exact: true }) });
const tabs = (page: Page) => page.getByRole('navigation', { name: 'Town Hall sections' });
type Scenario = {
    materials?: number; provisions?: number; sharedMaterials: number; sharedFields: boolean;
    gameReads: number; mapReads: number; mapError: boolean;
    onMap?: (route: Route, body: unknown) => Promise<void>;
};

async function installStores(page: Page) {
    const save = uiAuditSave();
    save.character = { ...save.character, itemStacks: [{ itemId: 'hunt-ash-scale', count: 3 }] };
    const runtime = await installUiAuditRuntime(page, save);
    const state: Scenario = { materials: 20, provisions: 4, sharedMaterials: 0, sharedFields: true, gameReads: 0, mapReads: 0, mapError: false };
    await page.route('**/api/game-state', route => {
        if (route.request().method() !== 'GET') return route.fulfill({ json: { ok: true } });
        state.gameReads++;
        return route.fulfill({ json: { villageStates: { stormveilvillage: { treasury: state.sharedFields ? { materialPoints: state.sharedMaterials, provisions: 0 } : {} } }, arenaActiveFights: [] } });
    });
    await page.route('**/api/village/war-map', route => {
        state.mapReads++;
        const body = { ok: true, villages: [{ village, provisions: state.provisions, materialPoints: state.materials, storesLedger: [], structures: {} }], contests: [] };
        if (state.onMap) return state.onMap(route, body);
        return state.mapError ? route.fulfill({ status: 503, json: { error: 'Temporarily unavailable' } }) : route.fulfill({ json: body });
    });
    return { save, runtime, state };
}

test('confirmed stores survive stale shared-state polling and keep refreshing', async ({ page }, testInfo) => {
    test.setTimeout(75_000);
    await page.clock.install();
    const { runtime, state } = await installStores(page);
    await expectUiAuditBoot(page, runtime, 'townHall');
    await tabs(page).getByRole('button', { name: 'Treasury', exact: true }).click();
    // Drive the shared-state fetch clock beyond its jitter. Town Hall's
    // war-map refresh stays event-driven; its confirmed 20 must
    // survive a shared response deliberately held at 0.
    await page.clock.runFor(12_000);
    await expect.poll(() => state.gameReads).toBeGreaterThanOrEqual(2);
    await page.clock.runFor(12_000);
    const after24Seconds = { gameReads: state.gameReads, mapReads: state.mapReads };
    await expect(storesRow(page)).toHaveText('Materials: 20 materials');
    await expect(storesRow(page, 'Provisions')).toHaveText('Provisions: 4 rations');
    state.materials = 5;
    state.provisions = 0;
    state.sharedMaterials = 5; // The poll signals a move; the direct read supplies the balance.
    await page.clock.runFor(12_000);
    await page.clock.runFor(12_000);
    await expect(storesRow(page)).toHaveText('Materials: 5 materials');
    await expect(storesRow(page, 'Provisions')).toHaveText('Provisions: 0 rations');
    const afterVisible = state.mapReads;
    // Leaving both stores tabs stops their response to shared-state changes,
    // preserving the existing request memo without refreshing throughout Town Hall.
    await tabs(page).getByRole('button', { name: 'Council', exact: true }).click();
    await page.clock.runFor(12_000);
    expect(state.mapReads).toBe(afterVisible);
    await testInfo.attach('stores-request-counts', { body: JSON.stringify({ ...state, after24Seconds, afterVisible }), contentType: 'application/json' });
});

test('a donation receipt survives an older in-flight read and immediate tab re-entry', async ({ page }) => {
    test.setTimeout(75_000);
    await page.clock.install();
    const { runtime, save, state } = await installStores(page);
    await expectUiAuditBoot(page, runtime, 'townHall');
    await tabs(page).getByRole('button', { name: 'Treasury', exact: true }).click();
    await expect(storesRow(page)).toHaveText('Materials: 20 materials');
    let held: { route: Route; body: unknown } | undefined;
    state.onMap = async (route, body) => { held = { route, body }; };
    state.sharedMaterials = 10; // Trigger main's event-driven re-read, not a periodic scan.
    await page.clock.runFor(12_000);
    await page.clock.runFor(12_000);
    await expect.poll(() => Boolean(held)).toBe(true);
    const pendingCalls = state.mapReads;
    await page.clock.runFor(12_000);
    expect(state.mapReads).toBe(pendingCalls, 'a slow stores read must not overlap another poll');
    await page.route('**/api/village/treasury/donate', async route => {
        const body = route.request().postDataJSON() as { itemId: string };
        expect(body.itemId).toBe('hunt-ash-scale');
        const character = { ...save.character, itemStacks: [{ itemId: 'hunt-ash-scale', count: 2 }] };
        const version = runtime.currentVersion() + 1;
        runtime.commitServerCharacter(character, version);
        state.materials = 35;
        await route.fulfill({ json: { ok: true, character, _saveVersion: version, treasury: { provisions: 4, materialPoints: 35 }, stores: { provisions: 4, materialPoints: 35 } } });
    });
    await page.locator('label').filter({ hasText: /^Donate Item$/ }).locator('xpath=following-sibling::select[1]').selectOption('hunt-ash-scale');
    await page.getByRole('button', { name: 'Donate to Materials', exact: true }).click();
    await expect(storesRow(page)).toHaveText('Materials: 35 materials');
    // The old response lands while Treasury is still mounted: the mutation
    // revision, rather than an unmount guard, must protect the displayed 35.
    delete state.onMap;
    const lateResponse = page.waitForResponse(response => response.url().endsWith('/api/village/war-map'));
    await held!.route.fulfill({ json: held!.body });
    await (await lateResponse).finished();
    await page.clock.runFor(1_000);
    await expect(storesRow(page)).toHaveText('Materials: 35 materials');
    // Receipt invalidation also keeps that late 20 out of the module memo.
    await tabs(page).getByRole('button', { name: 'Command', exact: true }).click();
    await tabs(page).getByRole('button', { name: 'Treasury', exact: true }).click();
    await expect(storesRow(page)).toHaveText('Materials: 35 materials');
    await expect.poll(() => state.mapReads).toBeGreaterThanOrEqual(3);
    await page.clock.runFor(12_000);
    await expect(storesRow(page)).toHaveText('Materials: 35 materials');
});

test('unknown stores stay unknown on error, recover to verified zero, and retain it on refresh failure', async ({ page }) => {
    test.setTimeout(75_000);
    await page.clock.install();
    const { runtime, state } = await installStores(page);
    state.sharedFields = false;
    state.mapError = true;
    await expectUiAuditBoot(page, runtime, 'townHall');
    await tabs(page).getByRole('button', { name: 'Treasury', exact: true }).click();
    await expect(storesRow(page)).toHaveText('Materials: —');
    await expect(page.getByText('The stores could not be read. Try again in a moment.', { exact: true })).toBeVisible();
    state.mapError = false;
    state.materials = 0;
    state.provisions = 0;
    await tabs(page).getByRole('button', { name: 'Council', exact: true }).click();
    await tabs(page).getByRole('button', { name: 'Treasury', exact: true }).click();
    await expect(storesRow(page)).toHaveText('Materials: 0 materials');
    state.mapError = true;
    state.sharedFields = true;
    state.sharedMaterials = 999;
    await page.clock.runFor(12_000);
    await page.clock.runFor(12_000);
    await expect(storesRow(page)).toHaveText('Materials: 0 materials');
    await expect(storesRow(page, 'Provisions')).toHaveText('Provisions: 0 rations');
});
