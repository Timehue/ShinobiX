import { expect, test } from '@playwright/test';
import { expectUiAuditBoot, installUiAuditRuntime, uiAuditSave } from './helpers/ui-audit-runtime';
import { expectViewportSafe } from './helpers/adaptive-assertions';
import { expectVisibleTouchTarget } from './helpers/visible-target';

test('ordinary village members can view every Town Hall section with unobstructed war menus', async ({ page }, testInfo) => {
    test.setTimeout(90_000);
    const save = uiAuditSave();
    save.character = { ...save.character, level: 1, rankTitle: 'Academy Student', examsPassed: [] };
    const runtime = await installUiAuditRuntime(page, save);
    const village = 'Stormveil Village', enemy = 'Moonshadow Village', warId = 'moonshadowvillage-vs-stormveilvillage';
    const startsAt = Date.now() - 1000, endsAt = startsAt + 5 * 86400000;
    await page.route('**/api/village/kage?*', route => route.fulfill({ json: { seatedKage: 'AnotherNinja' } }));
    await page.route('**/api/world-state', route => route.fulfill({ json: { territories: [], standings: [], wars: [{
        id: warId, villages: [village, enemy], startedAt: startsAt, updatedAt: startsAt,
        campaignVersion: 2, campaignEndsAt: endsAt, warGroundSector: 47, warPoints: { [village]: 250, [enemy]: 100 }, hp: { [village]: 5000, [enemy]: 5000 }
    }] } }));
    await page.route('**/api/village/war-map', route => route.fulfill({ json: { ok: true, enabled: true, contests: [], villages: [{
        village, warResources: 1000, structures: { supplyDepot: 1, treasuryVault: 1 }, preparations: [{
            instance: `village:${warId}:g1`, rowKey: `world:war:${warId}`, kind: 'village', id: warId, enemy, startsAt, endsAt,
            levels: { watchtower: 1, barracks: 1, warAcademy: 1 }, alerts: []
        }]
    }] } }));
    await page.route('**/api/village/war-merc', route => route.fulfill({ json: { ok: true, contexts: [], tiers: [], leases: [], viewer: { canHire: false, canDeploy: false } } }));
    await page.route('**/api/village/war-campaign', route => route.fulfill({ json: { campaign: {
        version: 2, startsAt, endsAt, scores: { [village]: { pvp: 250, pve: 0, rawPve: 0, total: 250 }, [enemy]: { pvp: 100, pve: 0, rawPve: 0, total: 100 } },
        shrine: [{ id: 'shrine-0', sector: 47, mode: 'combat', opensAt: startsAt + 20 * 3600000, closesAt: startsAt + 86400000, bouts: 0, limit: 15, wins: {} }],
        strongholds: ['combat', 'pet', 'card'].map((mode, i) => ({ id: `home-${mode}`, village, mode, sector: 31 + i, opensAt: startsAt, closesAt: endsAt, bouts: 0, limit: 3, wins: {} })),
        intel: 0, hiddenStrongholds: 3, operationAllowance: { players: {} }, operationResetAt: startsAt + 86400000
    }, run: null, mission: null, defense: null } }));
    await expectUiAuditBoot(page, runtime, 'townHall');
    const nav = page.getByRole('navigation', { name: 'Town Hall sections' });
    await expect(nav.getByRole('button')).toHaveCount(8);
    expect(await nav.evaluate(el => getComputedStyle(el).position)).toBe('relative');
    for (const name of ['Command', 'War', 'Upgrades', 'Treasury', 'Guard', 'Orders', 'Mercenaries', 'Council']) {
        const tab = nav.getByRole('button', { name, exact: true });
        await tab.scrollIntoViewIfNeeded();
        await expectVisibleTouchTarget(tab);
        expect(await tab.locator('strong').evaluate(el => el.scrollWidth <= el.clientWidth + 1 && el.scrollHeight <= el.clientHeight + 1)).toBe(true);
        await tab.click();
        await expect(tab).toHaveAttribute('aria-pressed', 'true');
        if (name === 'Mercenaries') {
            await expect(page.locator('.vwm-mercs').getByRole('heading', { name: 'Mercenaries', exact: true })).toBeVisible();
            await expect(page.locator('.vwm-mercs').getByText(/Only your seated Kage or a current Elder can hire/)).toBeVisible();
        }
    }
    await nav.scrollIntoViewIfNeeded();
    await testInfo.attach('town-hall-all-eight-tabs', { body: await nav.screenshot({ path: testInfo.outputPath('town-hall-all-eight-tabs.png') }), contentType: 'image/png' });
    await nav.getByRole('button', { name: 'War', exact: true }).click();
    const preparations = page.getByRole('region', { name: 'Individual war preparations' });
    await expect(preparations.getByRole('heading', { name: /Watchtower Tier 1/ })).toBeVisible();
    await expect(preparations.getByRole('button', { name: /Upgrade/ })).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Field missions and intelligence' })).toBeVisible();
    await expect(page.getByRole('article', { name: 'War shrine overview' }).getByRole('button')).toHaveCount(0);
    const board = page.getByRole('region', { name: 'War operations', exact: true });
    await expect(board.getByRole('article', { name: 'Village war display' }).locator('.town-war-display-shrine-banner img')).toHaveAttribute('src', '/ui/village-war/war-shrine-landmark-gold-v1.webp');
    const expectedControlHeight = page.viewportSize()!.width <= 920 ? 48 : 44;
    for (const control of [board.getByRole('button', { name: 'War Hall', exact: true }), board.getByRole('button', { name: 'Choose war defense', exact: true }),
        board.getByText('How village war works', { exact: true }), board.getByRole('button', { name: 'Sector Map', exact: true }), board.getByText('How sector war works', { exact: true })]) {
        await control.scrollIntoViewIfNeeded();
        await expectVisibleTouchTarget(control);
        if (await control.evaluate(el => el.tagName === 'BUTTON')) {
            const height = (await control.boundingBox())!.height;
            expect(height).toBeGreaterThanOrEqual(expectedControlHeight - .5);
            expect(height).toBeLessThanOrEqual(expectedControlHeight + .5);
        }
    }
    await board.getByText('How village war works', { exact: true }).click();
    await expect(board.getByText(/personal daily caps/)).toBeVisible();
    await expectViewportSafe(page);
    await testInfo.attach('ordinary-member-war-menus', { body: await page.screenshot({ path: testInfo.outputPath('ordinary-member-war-menus.png') }), contentType: 'image/png' });
    await board.getByRole('button', { name: 'Choose war defense', exact: true }).click();
    await expect(nav.getByRole('button', { name: 'Guard', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('heading', { name: 'Village War Defense', exact: true })).toBeVisible();
});

test('Kage sector preparations bind a selected war and refresh a Watchtower purchase', async ({ page }, testInfo) => {
    const runtime = await installUiAuditRuntime(page, uiAuditSave());
    const village = 'Stormveil Village';
    let level = 0, pool = 1000, purchases = 0;
    const instance = 'sector:26:moonshadowvillage-vs-stormveilvillage:g1';
    const startsAt = Date.now() - 1000, endsAt = startsAt + 3 * 86400000;
    await page.route('**/api/village/kage?*', route => route.fulfill({ json: { seatedKage: 'AuditNinja' } }));
    await page.route('**/api/world-state', route => route.fulfill({ json: { territories: [], standings: [], wars: [] } }));
    await page.route('**/api/village/war-map', route => route.fulfill({ json: { ok: true, enabled: true, contests: [], villages: [{
        village, biome: 'volcano', homeSectors: [], sectors: [], sectorsHeld: 8, warResources: pool, warResourcesCap: 5000,
        treasurySeals: 1000, structures: { ramparts: 0, watchtower: level, barracks: 0, warAcademy: 0, supplyDepot: 0, treasuryVault: 0 },
        preparations: [{ instance, rowKey: 'shared:sector-war:26:moonshadowvillage-vs-stormveilvillage', kind: 'sector', id: '26:moonshadowvillage-vs-stormveilvillage', enemy: 'Moonshadow Village', sector: 26,
            startsAt, endsAt, levels: { watchtower: level, barracks: 0, warAcademy: 0 }, alerts: [] }],
        upkeepWr: level * 2, dormant: false, wrPerSector: 25, taxRatePct: 0, kageSeated: true, provisions: 100, materialPoints: 700,
    }] } }));
    await page.route('**/api/village/war-merc', route => route.fulfill({ json: { ok: true, contexts: [], leases: [], tiers: [], attacking: [], viewer: { canHire: true }, warResources: pool } }));
    await page.route('**/api/village/war-structure', route => {
        expect(route.request().postDataJSON()).toMatchObject({ playerName: 'AuditNinja', village, structure: 'watchtower', toLevel: 1, warInstance: instance });
        purchases++; level = 1; pool -= 40;
        return route.fulfill({ json: { ok: true, structure: 'watchtower', newLevel: level, cost: 40, currency: 'wr', remainingWr: pool } });
    });
    await expectUiAuditBoot(page, runtime, 'villageWarMap');
    const structures = page.locator('.vwm-structures');
    await expect(structures.getByRole('button')).toHaveCount(2);
    await expect(structures.getByRole('button', { name: /Ramparts/ })).toHaveCount(0);
    const preparations = page.getByRole('region', { name: 'Individual war preparations' });
    await expect(preparations.getByText(/Three tiers/)).toBeVisible();
    await expect(page.getByText(/Five-day village campaigns use queued player defenders and reusable ANBU copies/)).toBeVisible();
    await preparations.getByRole('button', { name: /Upgrade Watchtower/ }).click();
    await expect(preparations.getByRole('heading', { name: /Watchtower Tier 1/ })).toBeVisible();
    await expect(preparations.getByRole('button', { name: 'Watchtower complete' })).toBeDisabled();
    await expect(preparations.getByText(/960 WR available/)).toBeVisible();
    expect(purchases).toBe(1);
    await expectViewportSafe(page);
    await testInfo.attach('kage-fortifications', { body: await page.screenshot({ path: testInfo.outputPath('kage-fortifications.png'), fullPage: true }), contentType: 'image/png' });
});

test('Town Hall guides both war types at peace and links to both halls', async ({ page }, testInfo) => {
    const runtime = await installUiAuditRuntime(page, uiAuditSave());
    await page.route('**/api/world-state', route => route.fulfill({ json: { territories: [], standings: [], wars: [] } }));
    await page.route('**/api/village/war-map', route => route.fulfill({ json: { ok: true, enabled: true, villages: [], contests: [] } }));
    await expectUiAuditBoot(page, runtime, 'townHall');
    const board = page.getByRole('region', { name: 'War operations', exact: true });
    await expect(board.getByText('No active village war', { exact: true })).toBeVisible();
    await expect(board.getByText('0 active sector wars', { exact: true })).toBeVisible();
    await board.getByText('How village war works', { exact: true }).click();
    await expect(board.getByText(/Spars and ranked matches do not/)).toBeVisible();
    await board.getByText('How sector war works', { exact: true }).click();
    await expect(board.getByText(/a tie keeps it with the defender/)).toBeVisible();
    for (const image of await board.locator('img').all()) {
        await image.scrollIntoViewIfNeeded();
        await expect.poll(() => image.evaluate(img => (img as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    }
    await expectViewportSafe(page, { horizontalScrollers: ['.town-tabs'] });
    await testInfo.attach('town-war-board', { body: await page.screenshot({ path: testInfo.outputPath('town-war-board.png'), fullPage: true }), contentType: 'image/png' });
    await board.getByRole('button', { name: 'War Hall', exact: true }).click();
    await expect(page.locator('.app-shell[data-screen="villageWar"]')).toBeVisible();
    await page.getByRole('button', { name: '× Back', exact: true }).click();
    await expect(page.locator('.app-shell[data-screen="townHall"]')).toBeVisible();
    await page.getByRole('region', { name: 'War operations', exact: true }).getByRole('button', { name: 'Sector Map', exact: true }).click();
    await expect(page.locator('.app-shell[data-screen="villageWarMap"]')).toBeVisible();
});

test('Town Hall shows village campaign points, shrine schedule and a working defense shortcut', async ({ page }) => {
    const save = uiAuditSave();
    const runtime = await installUiAuditRuntime(page, save);
    const village = String(save.character!.village), enemy = 'Moonshadow Village';
    const startsAt = Date.now() - 3_600_000, endsAt = startsAt + 5 * 86_400_000;
    const campaign = { version: 2, startsAt, endsAt, scores: {}, shrine: [], strongholds: [], intel: 0, hiddenStrongholds: 3,
        operationAllowance: { total: 0, categories: {}, players: {} } };
    await page.route('**/api/world-state', route => route.fulfill({ json: { territories: [], standings: [], wars: [{
        id: 'moonshadowvillage-vs-stormveilvillage', villages: [village, enemy], startedAt: startsAt,
        updatedAt: startsAt, campaignVersion: 2, campaignEndsAt: endsAt, warGroundSector: 47,
        hp: { [village]: 5000, [enemy]: 5000 }, warPoints: { [village]: 250, [enemy]: 100 } }] } }));
    await page.route('**/api/village/war-map', route => route.fulfill({ json: { ok: true, enabled: true, villages: [], contests: [] } }));
    await page.route('**/api/village/war-campaign', route => route.fulfill({ json: { campaign, defense: null, run: null } }));
    await expectUiAuditBoot(page, runtime, 'townHall');
    const display = page.getByRole('article', { name: 'Village war display' });
    await expect(display.getByText(`At war with ${enemy}`, { exact: true })).toBeVisible();
    await expect(display.getByText(/250 War Points/)).toBeVisible();
    await expect(display.getByText(/100 War Points/)).toBeVisible();
    await expect(display.getByText(/Shrine window opens in/)).toBeVisible();
    await expect(display.getByText(/Ends in 4d/)).toBeVisible();
    await display.getByRole('button', { name: 'Choose war defense', exact: true }).click();
    await expect(page.getByRole('navigation', { name: 'Town Hall sections' }).getByRole('button', { name: 'Guard', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('heading', { name: 'Village War Defense', exact: true })).toBeVisible();
});

test('Town Hall tracks sector modes and scores, recovers a failed refresh and removes ended contests', async ({ page }) => {
    test.setTimeout(90_000);
    const runtime = await installUiAuditRuntime(page, uiAuditSave());
    const village = 'Stormveil Village', enemy = 'Moonshadow Village';
    const endsAt = Date.now() + 2 * 86_400_000;
    let failed = true, ended = false;
    let ownPoints = 80;
    await page.route('**/api/world-state', route => route.fulfill({ json: { territories: [], standings: [], wars: [] } }));
    await page.route('**/api/village/war-map', route => {
        if (failed) return route.fulfill({ status: 503, json: { error: 'Unavailable' } });
        const contests = (['combat', 'pet', 'card'] as const).map((winCondition, index) => ({ id: `sector-${index}`, sector: 20 + index,
            attackerVillage: index === 1 ? enemy : village, defenderVillage: index === 1 ? village : enemy,
            winCondition, attackerPoints: index === 1 ? 30 : ownPoints, defenderPoints: index === 1 ? ownPoints : 30,
            endsAt: ended ? Date.now() - 1000 : endsAt, flipped: false }));
        return route.fulfill({ json: { ok: true, enabled: true, villages: [], contests: [...contests, {
            id: 'foreign', sector: 99, attackerVillage: enemy, defenderVillage: 'Frostfang Village',
            winCondition: 'card', attackerPoints: 1, defenderPoints: 0, endsAt, flipped: false }] } });
    });
    await expectUiAuditBoot(page, runtime, 'townHall');
    const display = page.getByRole('article', { name: 'Sector war display' });
    await expect(display.getByText('Sector war status unavailable', { exact: true })).toBeVisible();
    await expect(display.getByText('0 active sector wars', { exact: true })).toHaveCount(0);
    failed = false;
    await expect(display.getByText('3 active sector wars', { exact: true })).toBeVisible({ timeout: 25_000 });
    await expect(display.getByText('Sector 20 · Shinobi combat', { exact: true })).toBeVisible();
    await expect(display.getByText('Sector 21 · Pet battle', { exact: true })).toBeVisible();
    await expect(display.getByText('Sector 22 · Card battle', { exact: true })).toBeVisible();
    await expect(display.getByText(/Our points 80/)).toHaveCount(3);
    await expect(display.getByText(/Sector 99/)).toHaveCount(0);
    failed = true;
    await expect(display.getByText(/Showing the last reported sector scores/)).toBeVisible({ timeout: 25_000 });
    await expect(display.getByText(/Our points 80/)).toHaveCount(3);
    failed = false; ownPoints = 120;
    await expect(display.getByText(/Our points 120/)).toHaveCount(3, { timeout: 25_000 });
    ended = true;
    await expect(display.getByText('0 active sector wars', { exact: true })).toBeVisible({ timeout: 25_000 });
    await expect(display.locator('.town-war-display-contests')).toHaveCount(0);
});


test('Town Hall selects individual wars, shows boosted missions and keeps economic infrastructure permanent', async ({ page }, testInfo) => {
    const runtime = await installUiAuditRuntime(page, uiAuditSave());
    const village = 'Stormveil Village', enemy = 'Moonshadow Village';
    const startsAt = Date.now() - 1000, endsAt = startsAt + 5 * 86400000;
    const warId = 'moonshadowvillage-vs-stormveilvillage';
    const campaignInstance = 'village:' + warId + ':g2';
    const sectorInstance = 'sector:26:moonshadowvillage-vs-stormveilvillage:g1';
    await page.route('**/api/village/kage?*', route => route.fulfill({ json: { seatedKage: 'AuditNinja' } }));
    await page.route('**/api/world-state', route => route.fulfill({ json: { territories: [], standings: [], wars: [{
        id: warId, villages: [village, enemy], declarationGeneration: 2, startedAt: startsAt, updatedAt: startsAt,
        campaignVersion: 2, campaignEndsAt: endsAt, warPoints: {}, hp: { [village]: 5000, [enemy]: 5000 } }] } }));
    let sectorTier = 0, pool = 1000;
    await page.route('**/api/village/war-map', route => route.fulfill({ json: { ok: true, enabled: true, contests: [], villages: [{
        village, biome: 'volcano', homeSectors: [], sectors: [], sectorsHeld: 8, warResources: pool, treasurySeals: 1000,
        structures: { supplyDepot: 3, treasuryVault: 2 }, preparations: [
            { instance: campaignInstance, rowKey: 'world:war:' + warId, kind: 'village', id: warId, enemy, startsAt, endsAt,
                levels: { watchtower: 3, barracks: 1, warAcademy: 3 }, alerts: [{ id: 'assault', sector: 19, mode: 'pet', at: startsAt }] },
            { instance: sectorInstance, rowKey: 'shared:sector-war:26:moonshadowvillage-vs-stormveilvillage', kind: 'sector', id: 'sector-26', enemy,
                sector: 26, startsAt, endsAt: startsAt + 3 * 86400000, levels: { watchtower: 0, barracks: sectorTier, warAcademy: 0 }, alerts: [] }
        ], dormant: false, upkeepWr: 20, wrPerSector: 25, depotDailyIncome: 15, taxRatePct: 0,
    }] } }));
    await page.route('**/api/village/war-campaign', route => route.fulfill({ json: { campaign: {
        version: 2, startsAt, endsAt, scores: {}, shrine: [], strongholds: [], intel: 72, hiddenStrongholds: 0,
        operationAllowance: { total: 0, categories: {}, players: {} }, operationResetAt: startsAt + 86400000,
        supportTiers: { watchtower: 3, warAcademy: 3 }, espionageBonusUsed: false
    }, defense: null, run: null, mission: null } }));
    await page.route('**/api/village/war-merc', route => route.fulfill({ json: { ok: true, contexts: [], tiers: [], leases: [] } }));
    await page.route('**/api/village/war-structure', route => {
        expect(route.request().postDataJSON()).toMatchObject({ structure: 'barracks', toLevel: 1, warInstance: sectorInstance });
        sectorTier = 1; pool -= 40;
        return route.fulfill({ json: { ok: true, newLevel: 1, cost: 40, currency: 'wr' } });
    });
    await expectUiAuditBoot(page, runtime, 'townHall');
    await page.getByRole('navigation', { name: 'Town Hall sections' }).getByRole('button', { name: 'War', exact: true }).click();
    const preparations = page.getByRole('region', { name: 'Individual war preparations' });
    await expect(preparations.getByRole('heading', { name: /War Academy Tier 3/ })).toBeVisible();
    await expect(preparations.getByRole('button', { name: 'War Academy complete' })).toBeDisabled();
    await expect(preparations.getByText(/Sector 19 · Pet battle assault/)).toBeVisible();
    const missions = page.getByRole('region', { name: 'Field missions and intelligence' });
    await expect(missions.getByText('13 support points · +1 intel', { exact: true })).toBeVisible();
    await expect(missions.getByText('26 support points · +2 intel', { exact: true })).toBeVisible();
    await expect(missions.getByText(/Watchtower: \+3 intel/)).toBeVisible();
    await expect(missions.getByText('Your attempts today: 0/4.', { exact: false })).toBeVisible();
    await preparations.getByRole('combobox', { name: 'War to prepare for' }).selectOption(sectorInstance);
    await expect(preparations.getByRole('heading', { name: /War Academy Tier 0/ })).toBeVisible();
    await preparations.getByRole('button', { name: /Upgrade Barracks/ }).click();
    await expect(preparations.getByRole('heading', { name: /Barracks Tier 1/ })).toBeVisible();
    await expect(preparations.getByText(/960 WR available/)).toBeVisible();
    await expectViewportSafe(page, { horizontalScrollers: ['.town-tabs'] });
    await testInfo.attach('town-war-preparations', { body: await page.screenshot({ path: testInfo.outputPath('town-war-preparations.png'), fullPage: true }), contentType: 'image/png' });
    await page.getByRole('navigation', { name: 'Town Hall sections' }).getByRole('button', { name: 'Upgrades', exact: true }).click();
    const permanent = page.locator('.town-war-structures');
    await expect(permanent.getByText('Supply Depot', { exact: true })).toBeVisible();
    await expect(permanent.getByText('Treasury Vault', { exact: true })).toBeVisible();
    await expect(permanent.getByText('Barracks', { exact: true })).toHaveCount(0);
    await expect(permanent.getByText('War Academy', { exact: true })).toHaveCount(0);
});
