import { expect, test } from '@playwright/test';
import { expectUiAuditBoot, installUiAuditRuntime, uiAuditSave } from './helpers/ui-audit-runtime';
import { expectViewportSafe } from './helpers/adaptive-assertions';
import { isWalkableTile, nearestWalkableTile } from '../../shared/sector-walk-mask';
import { sectorFloorLayout } from '../src/lib/sector-floor-layout';

// Fixed, not Date.now(): these cooldowns leave the angler and rift slots open and the sky follows the clock, so the cast changed every 6 h bucket; 01:00 UTC is world noon.
const WAR_SCENARIO_EPOCH = Date.UTC(2026, 9, 10, 1);

for (const [mode, label] of [['combat', 'Shinobi PvP'], ['pet', 'Pet battles only'], ['card', 'Card battles only']] as const) {
    test(`a revealed ${mode} war stronghold admits physical entry and binds its specialty assault`, async ({ page }, info) => {
        test.setTimeout(90_000);
        const now = WAR_SCENARIO_EPOCH;
        await page.clock.install({ time: new Date(now) });
        const save = { ...uiAuditSave(), currentSector: 18, currentTile: sectorFloorLayout(18)!.sites.stronghold!.approach };
        const bucket = Math.floor(now / (6 * 3_600_000)), cooldowns: Record<string, number> = {};
        for (const offset of [-1, 0, 1]) for (const index of [0, 1, 2]) cooldowns[`w-18-${bucket + offset}-${index}`] = now + 30 * 86_400_000;
        save.character = { ...save.character, level: 15, wandererCooldowns: cooldowns };
        const runtime = await installUiAuditRuntime(page, save);
        await page.addInitScript(() => localStorage.setItem('legacyRumors.seen.v1:auditninja', JSON.stringify([10, 20, 30, 40, 45])));
        const village = 'Stormveil Village', enemy = 'Moonshadow Village', warId = 'moonshadowvillage-vs-stormveilvillage';
        const startsAt = now - 3_600_000, endsAt = startsAt + 5 * 86_400_000;
        const objective = { id: `enemy-${mode}`, mode, sector: 18, village: enemy, opensAt: startsAt, closesAt: endsAt, limit: 3, bouts: 0, wins: {} };
        const campaign = { version: 2, startsAt, endsAt, shrine: [], strongholds: [objective], intel: 72, hiddenStrongholds: 0,
            scores: { [village]: { pvp: 0, pve: 0, rawPve: 0, total: 0 } },
            operationAllowance: { total: 0, categories: {}, players: {} }, operationResetAt: startsAt + 86_400_000 };
        const actions: Record<string, unknown>[] = [], errors: string[] = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.route('**/api/world-state', route => route.fulfill({ json: { territories: [], standings: [], wars: [{ id: warId,
            villages: [village, enemy], startedAt: startsAt, updatedAt: startsAt, campaignVersion: 2, campaignEndsAt: endsAt,
            warGroundSector: 47, hp: { [village]: 5000, [enemy]: 5000 }, warPoints: { [village]: 0, [enemy]: 0 } }] } }));
        await page.route('**/api/village/war-campaign', route => {
            const body = route.request().postDataJSON(); actions.push(body);
            if (body.action === 'start') return route.fulfill({ status: 409, json: { error: 'Finish your current combat settlement first.' } });
            return route.fulfill({ json: { campaign, mission: null, run: null, defense: null } });
        });
        await expectUiAuditBoot(page, runtime, 'worldMap');
        await page.getByRole('button', { name: '← Return to Sector 18', exact: true }).click();
        await page.getByRole('button', { name: /Moonshadow Village Sector Stronghold.*infiltrate/ }).click();
        await page.getByRole('dialog').getByRole('button',{name:'Enter the stronghold',exact:true}).click();
        const prompt = page.getByRole('dialog');
        await expect(prompt.getByText(/Human victories earn 50 War Points/)).toBeVisible();
        await expect(prompt.getByText(/Explore 12 chambers/)).toHaveCount(0);
        await expect(prompt.getByText(new RegExp(label))).toBeVisible();
        await prompt.getByRole('button', { name: 'Enter war stronghold', exact: true }).click();
        const panel = page.getByRole('region', { name: 'Village war campaign' });
        await expect(panel.getByRole('heading', { name: 'Enemy stronghold · Sector 18', exact: true })).toBeVisible();
        await expect(panel.getByText(label, { exact: true })).toBeVisible();
        expect(actions.find(a => a.action === 'enter')?.objectiveId).toBe(objective.id);
        await panel.getByRole('button', { name: 'Attack the ANBU defense', exact: true }).click();
        await expect(panel.getByRole('alert')).toHaveText('Finish your current combat settlement first.');
        expect(actions.find(a => a.action === 'start')?.objectiveId).toBe(objective.id);
        await page.screenshot({ path: info.outputPath(`${mode}-physical-stronghold.png`) });
        await panel.getByRole('button', { name: 'Leave stronghold', exact: true }).click();
        await expect(panel).toHaveCount(0);
        expect(actions.some(a => a.action === 'leave' && a.objectiveId === objective.id)).toBe(true);
        expect(errors).toEqual([]);
    });
}

test('an espionage traveler enters the assigned stronghold, sees sentry and player choices, and physically leaves', async ({ page }, testInfo) => {
    test.setTimeout(90_000);
    const now = WAR_SCENARIO_EPOCH;
    await page.clock.install({ time: new Date(now) });
    const save = { ...uiAuditSave(), currentSector: 18, currentTile: nearestWalkableTile(18, 78) };
    const bucket = Math.floor(now / (6 * 3_600_000)), cooldowns: Record<string, number> = {};
    for (const offset of [-1, 0, 1]) for (const index of [0, 1, 2]) cooldowns[`w-18-${bucket + offset}-${index}`] = now + 30 * 86_400_000;
    save.character = { ...save.character, level: 15, wandererCooldowns: cooldowns };
    const runtime = await installUiAuditRuntime(page, save);
    await page.addInitScript(() => localStorage.setItem('legacyRumors.seen.v1:auditninja', JSON.stringify([10, 20, 30, 40, 45])));
    const village = 'Stormveil Village', enemy = 'Moonshadow Village', warId = 'moonshadowvillage-vs-stormveilvillage';
    const startsAt = now - 3_600_000, endsAt = startsAt + 5 * 86_400_000;
    const campaign = { version: 2, startsAt, endsAt, shrine: [], strongholds: [], scores: {}, intel: 0, hiddenStrongholds: 3,
        operationAllowance: { total: 1, categories: { espionage: 1 }, players: {} }, operationResetAt: startsAt + 86_400_000 };
    const mission = { id: 'vwm-fixture', kind: 'espionage', village, enemy, createdAt: now, sectors: [18], completedSectors: [],
        status: 'active', holdSeconds: 0, holdRequired: 0, insideStronghold: false, serverNow: now };
    const actions: Record<string, unknown>[] = [], errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/world-state', route => route.fulfill({ json: { territories: [], standings: [], wars: [{ id: warId,
        villages: [village, enemy], startedAt: startsAt, updatedAt: startsAt, campaignVersion: 2, campaignEndsAt: endsAt,
        warGroundSector: 47, hp: { [village]: 5000, [enemy]: 5000 }, warPoints: { [village]: 0, [enemy]: 0 } }] } }));
    await page.route('**/api/village/war-campaign', async route => {
        const body = route.request().postDataJSON(); actions.push(body);
        if (body.action === 'operation-enter') mission.insideStronghold = true;
        if (body.action === 'operation-leave') mission.insideStronghold = false;
        mission.serverNow = await page.evaluate(() => Date.now());
        if (body.action === 'start') return route.fulfill({ status: 409, json: { error: 'Finish your current combat settlement first.' } });
        return route.fulfill({ json: { campaign, mission, run: null, defense: null,
            peers: mission.insideStronghold ? [{ name: 'MoonShinobi', level: 100, village: enemy, inBattle: false }] : [] } });
    });
    await expectUiAuditBoot(page, runtime, 'worldMap');
    const back = page.getByRole('button', { name: '← Return to Sector 18', exact: true });
    await expect(back).toBeVisible(); await back.click();
    const tracker = page.locator('.war-field-hud'); await expect(tracker).toBeVisible(); await tracker.locator('summary').click();
    await expect(tracker.getByText(/Enter the enemy stronghold in Sector 18/)).toBeVisible();
    await expect(page.locator('.resource-node-layer')).toBeVisible();
    await expect(page.locator('.continuous-world-map')).toHaveAttribute('aria-busy', 'false');
    const trackerBeforeWalk = await tracker.boundingBox(), terrain = page.locator('[data-world-chunk="18"]');
    const terrainBeforeWalk = await terrain.getAttribute('style');
    const tile = save.currentTile;
    const direction = [{ key: 'ArrowRight', next: tile + 1, valid: tile % 12 < 11 }, { key: 'ArrowDown', next: tile + 12, valid: tile < 132 },
        { key: 'ArrowLeft', next: tile - 1, valid: tile % 12 > 0 }, { key: 'ArrowUp', next: tile - 12, valid: tile >= 12 }].find(step => step.valid && isWalkableTile(18, step.next));
    expect(direction).toBeTruthy();
    await page.locator('canvas[aria-label^="World terrain"]').focus();
    await page.keyboard.down(direction!.key); await page.waitForTimeout(250); await page.keyboard.up(direction!.key);
    await expect.poll(() => terrain.getAttribute('style')).not.toBe(terrainBeforeWalk);
    const trackerAfterWalk = await tracker.boundingBox();
    expect(Math.abs(trackerAfterWalk!.x - trackerBeforeWalk!.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(trackerAfterWalk!.y - trackerBeforeWalk!.y)).toBeLessThanOrEqual(1);
    await tracker.getByRole('button', { name: 'Enter mission stronghold' }).click();
    const room = page.getByRole('dialog', { name: 'Enemy stronghold · Sector 18', exact: true });
    await expect(room).toBeVisible();
    expect(actions.find(a => a.action === 'operation-enter')?.missionId).toBe(mission.id);
    await expect(room.getByRole('button', { name: 'Fight stronghold sentry' })).toBeEnabled();
    await expect(room.getByText('MoonShinobi · Level 100')).toBeVisible();
    await expect.poll(() => room.locator('img').evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    await room.getByRole('button', { name: 'Fight stronghold sentry' }).click();
    await expect(room.getByRole('alert')).toHaveText('Finish your current combat settlement first.');
    expect(actions.find(a => a.action === 'start')?.fieldMissionId).toBe(mission.id);
    const bounds = await room.boundingBox(); expect(bounds?.x).toBeGreaterThanOrEqual(-1);
    expect((bounds?.x ?? 0) + (bounds?.width ?? 0)).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
    await testInfo.attach('espionage-stronghold', { body: await page.screenshot({ path: testInfo.outputPath('espionage-stronghold.png') }), contentType: 'image/png' });
    await expectViewportSafe(page, { horizontalScrollers: ['.world-map-grid', '.world-sector-stage'] });
    await room.getByRole('button', { name: 'Leave stronghold', exact: true }).click();
    await expect(room).toHaveCount(0); expect(actions.some(a => a.action === 'operation-leave')).toBe(true);
    expect(actions.find(a => a.action === 'operation-leave')?.missionId).toBe(mission.id);
    expect(errors).toEqual([]);
});

test('a level-15 village defender takes guard duty in an owned stronghold and can confront an espionage visitor', async ({ page }, testInfo) => {
    test.setTimeout(90_000);
    const now = WAR_SCENARIO_EPOCH;
    await page.clock.install({ time: new Date(now) });
    const sector = 4, save = { ...uiAuditSave(), currentSector: sector, currentTile:sectorFloorLayout(sector)!.sites.stronghold!.approach };
    save.triggeredEvents = [...(save.triggeredEvents ?? []), 'story-interlude-stormveil-village-88', 'story-interlude-stormveil-village-92'];
    const bucket = Math.floor(now / (6 * 3_600_000)), cooldowns: Record<string, number> = {};
    for (const offset of [-1, 0, 1]) for (const index of [0, 1, 2]) cooldowns[`w-${sector}-${bucket + offset}-${index}`] = now + 30 * 86_400_000;
    save.character = { ...save.character, level: 15, wandererCooldowns: cooldowns };
    const runtime = await installUiAuditRuntime(page, save);
    await page.addInitScript(() => localStorage.setItem('legacyRumors.seen.v1:auditninja', JSON.stringify([10, 20, 30, 40, 45])));
    const village = 'Stormveil Village', enemy = 'Moonshadow Village', startsAt = now - 1000, endsAt = startsAt + 5 * 86_400_000;
    const campaign = { version: 2, startsAt, endsAt, shrine: [], strongholds: [], scores: {}, intel: 0, hiddenStrongholds: 3,
        operationAllowance: { total: 0, categories: {}, players: {} }, operationResetAt: startsAt + 86_400_000 };
    const actions: Record<string, unknown>[] = [];
    await page.route('**/api/world-state', route => route.fulfill({ json: { territories: [{ sector, ownerVillage: village, ownerClan: '', hp: 20000 }], standings: [], wars: [{
        id: 'moonshadowvillage-vs-stormveilvillage', villages: [village, enemy], startedAt: startsAt, updatedAt: startsAt,
        campaignVersion: 2, campaignEndsAt: endsAt, hp: { [village]: 5000, [enemy]: 5000 }, warGroundSector: 47, warPoints: {} }] } }));
    await page.route('**/api/village/war-campaign', route => {
        const body = route.request().postDataJSON(); actions.push(body);
        const inside = body.action === 'guard-enter' || body.action === 'guard-state';
        return route.fulfill({ json: { campaign, mission: null, run: null, defense: null, guard: { sector, inside },
            peers: inside ? [{ name: 'MoonSpy', level: 15, village: enemy, hp: 1000, maxHp: 1000, inBattle: false,
                stronghold: { sector, tile: 0 } }] : [] } });
    });
    await expectUiAuditBoot(page, runtime, 'worldMap');
    const back = page.getByRole('button', { name: `← Return to Sector ${sector}`, exact: true }); await expect(back).toBeVisible(); await back.click();
    // The world pauses under a stronghold instead of being torn down: leaving
    // must not rebuild the world (a new canvas, renderer and decoded maps); it
    // only re-reads its position once.
    const world = page.locator('.continuous-world-map');
    await expect(world).toHaveAttribute('aria-busy', 'false', { timeout: 30_000 });
    await world.locator('canvas[aria-label^="World terrain"]').evaluate(canvas => { (canvas as HTMLCanvasElement & { strongholdProbe?: boolean }).strongholdProbe = true; });
    await page.getByRole('button', { name: /Sector Stronghold — defend/ }).click();
    await page.getByRole('dialog').getByRole('button',{name:'Enter the stronghold',exact:true}).click();
    const entrance = page.getByRole('dialog', { name: `Sector ${sector} Stronghold`, exact: true });
    await expect(entrance.getByText(/Take guard duty from level 15/)).toBeVisible();
    await entrance.getByRole('button', { name: 'Enter stronghold', exact: true }).click();
    const room = page.getByRole('dialog', { name: `Guard duty · Sector ${sector}`, exact: true }); await expect(room).toBeVisible();
    await expect(room.getByText('MoonSpy · Level 15', { exact: true })).toBeVisible();
    await expect(room.getByRole('button', { name: 'Attack', exact: true })).toBeEnabled();
    await expect(room.getByRole('button', { name: /sentry|Anbu|patrol/i })).toHaveCount(0);
    await expect.poll(() => room.locator('img').evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    await expectViewportSafe(page, { horizontalScrollers: ['.world-map-grid', '.world-sector-stage'] });
    await testInfo.attach('owned-stronghold-defense', { body: await page.screenshot({ path: testInfo.outputPath('owned-stronghold-defense.png') }), contentType: 'image/png' });
    await room.getByRole('button', { name: 'Leave stronghold', exact: true }).click(); await expect(room).toHaveCount(0);
    await expect(world).toHaveAttribute('aria-busy', 'false');
    expect(await world.locator('canvas[aria-label^="World terrain"]').evaluate(canvas => (canvas as HTMLCanvasElement & { strongholdProbe?: boolean }).strongholdProbe),
        'the same world canvas survives the stronghold visit').toBe(true);
    const entry = actions.find(a => a.action === 'guard-enter'), leave = actions.find(a => a.action === 'guard-leave');
    expect(entry?.sector).toBe(sector); expect(entry?.visitId).toBeTruthy(); expect(leave?.visitId).toBe(entry?.visitId);
});
