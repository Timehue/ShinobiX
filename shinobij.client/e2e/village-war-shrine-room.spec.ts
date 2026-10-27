import { expect, test } from '@playwright/test';
import { installUiAuditRuntime, expectUiAuditBoot, uiAuditSave } from './helpers/ui-audit-runtime';
import { expectViewportSafe } from './helpers/adaptive-assertions';
import { sectorArtKey } from '../../shared/sector-geo';

// Fixed, not Date.now(): a roaming Legacy Emissary ignores wanderer cooldowns, and no sector has one at any hour of 2026-10-10 (01:00 UTC is world noon).
const WAR_SCENARIO_EPOCH = Date.UTC(2026, 9, 10, 1);

for (const version of [2, 3] as const) for (const capped of [false, true]) test(`v${version}: travelers enter, move and leave the golden shrine with ${capped ? "capped" : "zero"} scored bouts; control stays open until closing`, async ({ page }, testInfo) => {
    test.setTimeout(90_000);
    const now = WAR_SCENARIO_EPOCH;
    await page.clock.install({ time: new Date(now) });
    const save = { ...uiAuditSave(), currentSector: 40 };
    const bucket = Math.floor(now / (6 * 3_600_000)), wandererCooldowns: Record<string, number> = {};
    for (const offset of [-1, 0, 1]) for (const index of [0, 1, 2]) wandererCooldowns[`w-40-${bucket + offset}-${index}`] = now + 30 * 86_400_000;
    save.character = { ...save.character, wandererCooldowns };
    const runtime = await installUiAuditRuntime(page, save);
    await page.addInitScript(() => localStorage.setItem('legacyRumors.seen.v1:auditninja', JSON.stringify([10, 20, 30, 40, 45])));
    const village = 'Stormveil Village', enemy = 'Moonshadow Village', warId = 'moonshadowvillage-vs-stormveilvillage';
    const scoredBouts = capped ? (version === 2 ? 15 : 10) : 0;
    const startsAt = now - (version === 2 ? 21 : 3) * 3_600_000, endsAt = startsAt + 5 * 86_400_000;
    const objective = { id: 'shrine-0', sector: 40, mode: 'combat', opensAt: startsAt + (version === 2 ? 20 : 2) * 3_600_000,
        closesAt: startsAt + (version === 2 ? 24 : 4) * 3_600_000, bouts: scoredBouts, limit: version === 2 ? 15 : 10, wins: {}, controlTimeMs: { [village]: 120_000, [enemy]: 60_000 } };
    const campaign = { version, startsAt, endsAt, scores: { [village]: { pvp: 250, pve: 0, rawPve: 0, total: 250 },
        [enemy]: { pvp: 100, pve: 0, rawPve: 0, total: 100 } }, shrine: [objective], strongholds: [],
        hiddenStrongholds: 3, intel: 0, operationAllowance: { total: 0, categories: {}, players: {} } };
    let tile = 126, rivalInside = true, closedAt = 0;
    const actions: Record<string, unknown>[] = [], errors: string[] = [];
    let worldSteps = 0;
    page.on('request', request => { if (request.url().endsWith('/api/player/world-move') && request.method() === 'POST') worldSteps++; });
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/world-state', route => route.fulfill({ json: { territories: [], standings: [], wars: [{
        id: warId, villages: [village, enemy], startedAt: startsAt, updatedAt: startsAt, campaignVersion: version,
        campaignEndsAt: endsAt, warGroundSector: 40, hp: { [village]: 5000, [enemy]: 5000 }, warPoints: { [village]: 250, [enemy]: 100 } }] } }));
    let holdStep: Promise<void> | null = null;
    await page.route('**/api/village/war-campaign', async route => {
        const body = route.request().postDataJSON();
        actions.push(body);
        if (body.action === 'shrine-step') { if (holdStep) await holdStep; tile = body.tile; }
        const players = [{ name: 'auditninja', displayName: 'AuditNinja', village, tile, inBattle: false },
            ...(rivalInside ? [{ name: 'moonshinobi', displayName: 'MoonShinobi', village: enemy, tile: 65, inBattle: false }] : [])];
        return route.fulfill({ json: { campaign, defense: null, run: null,
            ...(String(body.action).startsWith('shrine-') ? { room: { objective: { ...objective, ...(!rivalInside ? { controlVillage: village } : {}),
                ...(closedAt ? { closesAt: closedAt, bonusSettled: true, ...(scoredBouts === 0 ? { bonusWinner: village } : { controlTimeMs: { [village]: 120_000, [enemy]: 120_000 } }) } : {}) },
                players, serverNow: await page.evaluate(() => Date.now()) } } : {}) } });
    });
    await expectUiAuditBoot(page, runtime, 'worldMap');
    const returnToSector = page.getByRole('button', { name: '← Return to Sector 40', exact: true });
    await returnToSector.click();
    await expect(page.locator('.continuous-world-map')).toHaveAttribute('aria-busy', 'false', { timeout: 30_000 });
    await page.evaluate(async src => { const image = new Image(); image.src = src; await image.decode();
        await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))); }, `/sector-map/s${sectorArtKey(40)}.webp`);
    const entrance = page.getByRole('button', { name: /Golden War Shrine · Open/ });
    await expect(entrance).toBeVisible();
    await expect(entrance).toBeEnabled();
    await expect.poll(() => entrance.locator('img').evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    await testInfo.attach('golden-shrine-sector', { body: await page.screenshot({ path: testInfo.outputPath('golden-shrine-sector.png') }), contentType: 'image/png' });
    await entrance.click();
    const room = page.getByRole('region', { name: 'Golden war shrine room' });
    await expect(room).toBeVisible();
    const dialog = page.getByRole('dialog', { name: 'Golden shrine interior' });
    expect(await dialog.evaluate(element => element.matches(':modal'))).toBe(true);
    await expect(room.getByText('Both villages are inside. The shrine is contested.', { exact: true })).toBeVisible();
    await expect(room.getByLabel('Uncontested control time')).toContainText(`${village} 0h 2m 0s`);
    await expect(room.getByLabel('Uncontested control time')).toContainText(`${enemy} 0h 1m 0s`);
    await expect(room.getByRole('button', { name: 'Fight MoonShinobi', exact: true })).toBeEnabled();
    await expect.poll(() => room.locator('.war-shrine-floor-art').evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    const headingBounds = await room.getByRole('heading', { name: 'Golden War Shrine' }).boundingBox();
    const leaveBounds = await room.getByRole('button', { name: 'Leave shrine', exact: true }).boundingBox();
    expect(leaveBounds!.width).toBeLessThanOrEqual(80);
    expect(leaveBounds!.y).toBeLessThan(headingBounds!.y + headingBounds!.height);
    expect(headingBounds!.y).toBeLessThan(leaveBounds!.y + leaveBounds!.height);
    const entryBounds = await room.boundingBox(), floorBounds = await room.locator('.war-shrine-floor-art').boundingBox();
    expect(floorBounds!.y - entryBounds!.y).toBeLessThanOrEqual(140);
    await testInfo.attach('golden-shrine-viewport', { body: await page.screenshot({ path: testInfo.outputPath('golden-shrine-viewport.png') }), contentType: 'image/png' });
    await room.getByRole('group', { name: 'Shrine floor' }).focus();
    const outsideSteps = worldSteps;
    await page.keyboard.press('ArrowUp');
    await expect.poll(() => tile).toBe(114);
    expect(worldSteps).toBe(outsideSteps, 'room movement must not move the character in the world outside');
    // The avatar moves when the step is sent, not a round trip later.
    const self = room.locator('.war-shrine-player', { hasText: 'You' });
    const rowOf = () => self.evaluate(element => (element as HTMLElement).style.top);
    const before = await rowOf();
    let release!: () => void;
    holdStep = new Promise<void>(resolve => { release = resolve; });
    await page.keyboard.press('ArrowUp');
    await expect.poll(rowOf, { timeout: 2_000 }).not.toBe(before);
    expect(tile, 'the server has not answered the step yet').toBe(114);
    // Every action that would be dropped behind the step in flight waits for it.
    await expect(room.getByRole('button', { name: 'Leave shrine', exact: true })).toBeDisabled();
    await expect(room.getByRole('button', { name: 'Fight MoonShinobi', exact: true })).toBeDisabled();
    release(); holdStep = null;
    await expect(room.getByRole('button', { name: 'Fight MoonShinobi', exact: true })).toBeEnabled();
    await expect.poll(() => tile).toBe(102);
    await expect.poll(async () => parseFloat(await rowOf())).toBeCloseTo(((Math.floor(102 / 12) + .5) / 12) * 100, 2);
    for (let tab = 0; tab < 3; tab++) {
        await page.keyboard.press('Tab');
        // Native dialogs may focus BODY for one Tab when cycling; the background
        // stays inert. No interactive control outside the modal may receive focus.
        expect(await page.evaluate(() => document.activeElement === document.body
            || document.activeElement?.closest('dialog')?.getAttribute('aria-label') === 'Golden shrine interior')).toBe(true);
    }
    await expect.poll(() => actions.filter(a => a.action === 'shrine-enter').length).toBe(1);
    // The underlying continuous-world camera intentionally pans its fixed tile
    // stage past the viewport; the native modal makes that background inert.
    await expectViewportSafe(page, { logicalStages: ['.continuous-world-map'] });
    const bounds = await dialog.boundingBox(), viewport = page.viewportSize()!;
    expect(bounds!.x).toBeGreaterThanOrEqual(0); expect(bounds!.y).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport.height);
    await testInfo.attach('golden-shrine-room', { body: await room.screenshot({ path: testInfo.outputPath('golden-shrine-room.png') }), contentType: 'image/png' });
    rivalInside = false;
    await expect(room.getByText('Your village controls the shrine and is adding uncontested time.', { exact: true })).toBeVisible({ timeout: 15_000 });
    closedAt = await page.evaluate(() => Date.now()) - 1;
    await expect(room.getByText(scoredBouts === 0 ? `${village} held the most uncontested time and earned ${version === 2 ? "1,000" : "100"} War Points.`
        : 'Uncontested time was tied or zero. No window bonus was awarded.', { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(room.getByText('This scoring window is complete.', { exact: true })).toBeVisible();
    await room.getByText('Controls and scoring', { exact: true }).click();
    if (version === 3) {
        await expect(room.getByText(/These continue after the extra-point cap: Kage wins earn 30/)).toBeVisible();
        await expect(room.getByText(/earn 20 extra War Points each/)).toBeVisible();
    } else {
        await expect(room.getByText(/These continue after the extra-point cap/)).toHaveCount(0);
        await expect(room.getByText(/earn 100 War Points each/)).toBeVisible();
    }
    await room.getByRole('button', { name: 'Leave shrine', exact: true }).click();
    await expect(room).toHaveCount(0);
    expect(actions.some(a => a.action === 'shrine-leave')).toBe(true);
    expect(actions.some(a => a.action === 'start')).toBe(false, 'entry and movement never fabricate a battle');
    expect(errors).toEqual([]);
});
