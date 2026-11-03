import { expect } from '@playwright/test';
import { test } from './helpers/reconnecting-request';
import { uiAuditSave } from '../e2e/helpers/ui-audit-runtime';
import { uniquePlayerName } from './helpers/player-names';
import { quietRoadCooldowns } from './helpers/quiet-road';
import { LATEST_PATCH_NOTE } from '../src/data/patch-notes';
import { sectorExits } from '../../shared/sector-links';
import { sectorName } from '../../shared/sector-geo';
import { writeFile } from 'node:fs/promises';
import { returnToWorldAtlas } from '../e2e/helpers/sector-navigation';

test.use({ contextOptions: { reducedMotion: 'no-preference' }, video: 'on' });
for (const transport of ['socket', 'http'] as const) test(`rival village crest opens connected outskirts and defenses (${transport})`, async ({ page, request, context }, info) => {
    test.setTimeout(180_000);
    test.skip(transport === 'socket' && process.env.LIVE_E2E_REALTIME !== '1', 'Socket coverage needs the live realtime server enabled.');
    if (transport === 'http') await context.route('**/socket.io/**', route => route.abort());
    const name = uniquePlayerName(stamp => `continuous${stamp}`);
    const registered = await request.post('/api/player-auth', { data: { action: 'register', name, password: 'ContinuousJourney!1234' } });
    expect(registered.status(), await registered.text()).toBe(200);
    const token = String((await registered.json()).token), headers = { 'x-player-name': name, 'x-player-token': token };
    const save = uiAuditSave(); save.currentSector = 40; save.currentTile = 78; save.worldGeoV = 2; save.currentBiome = 'central';
    save.character = { ...save.character, name, village: 'Ashen Leaf Village', storyVillage: 'Ashen Leaf Village',
        equippedJutsuIds: [], jutsuMastery: [], wandererCooldowns: quietRoadCooldowns(Array.from({ length: 65 }, (_, i) => i + 1)) };
    save.triggeredEvents = (save.triggeredEvents as string[]).map(event => event.replace('stormveil-village', 'ashen-leaf-village'));
    const seeded = await request.post(`/api/save/${name}?signal=1`, { headers: { 'x-admin-password': 'live-express-e2e-admin' }, data: save });
    expect(seeded.status(), await seeded.text()).toBe(200);
    expect((await request.post(`/api/save/${name}?ack=1`, { headers })).status()).toBe(200);
    const canonical = await (await request.get(`/api/save/${name}`, { headers })).json();
    await context.addInitScript(({ name, token, canonical, patch }) => {
        localStorage.setItem('ninjav-admin-build-v1', JSON.stringify({ currentAccountName: name }));
        localStorage.setItem('ninjav-player-accounts-v1', JSON.stringify({ [name]: { token } }));
        localStorage.setItem('shinobix:activePlayerPersist', name); localStorage.setItem('shinobix:activeTokenPersist', token);
        localStorage.setItem(`ninjav-save-preview-v1:${name.toLowerCase()}`, JSON.stringify(canonical));
        localStorage.setItem('shinobix:storage-notice-ack', '1'); localStorage.setItem('patchNotes.lastSeenVersion.v1', patch);
        localStorage.setItem('dailyBriefing.seen.v1', new Date().toISOString().slice(0, 10));
        localStorage.setItem('legacyRumors.seen.v1:' + name, JSON.stringify([10, 20, 30, 40, 45])); localStorage.setItem('liteFx.v1', '0');
    }, { name, token, canonical, patch: LATEST_PATCH_NOTE?.version ?? '' });
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    let socketConnected = false;
    page.on('websocket', socket => {
        if (socket.url().includes('/socket.io/')) socket.on('framereceived', frame => {
            // Authentication can finish over polling before the WebSocket upgrade.
            const packet = String(frame.payload);
            if (packet.startsWith('40') || packet === '3probe') socketConnected = true;
        });
    });
    await page.goto('/#/worldMap', { waitUntil: 'domcontentloaded' });
    const shell = page.locator('.app-shell[data-screen="worldMap"]'), enter = page.getByRole('button', { name: 'Enter World Map', exact: true });
    await expect(shell.or(enter)).toBeVisible({ timeout: 60_000 });
    if (await enter.isVisible()) await enter.click();
    await expect(shell).toBeVisible();
    const atlas = page.locator('.generated-world-map');
    await expect.poll(async () => await atlas.isVisible() || await page.locator('.sector-hud').isVisible()).toBe(true);
    if (!await atlas.isVisible()) await returnToWorldAtlas(page);
    if (await page.locator('html').evaluate(html => html.classList.contains('wm-zoom'))) {
        await page.locator('.wm-village-chip[data-region="moon"]').click();
    }
    const travel = page.waitForResponse(response => response.url().endsWith('/api/player/travel') && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Enter Moonshadow Village', exact: true }).click();
    const admitted = await travel;
    expect(admitted.request().postDataJSON().destinationSector).toBe(17);
    expect(admitted.status(), await admitted.text()).toBe(200);
    const board = page.locator('.continuous-world-map'), canvas = board.locator(':scope > canvas');
    await expect(board).toHaveAttribute('aria-busy', 'false', { timeout: 60_000 });
    const arrivalDialog = page.getByRole('dialog', { name: 'Moonshadow Village defenses', exact: true });
    await expect(arrivalDialog).toContainText('AI garrison');
    await arrivalDialog.getByRole('button', { name: 'Return to outskirts', exact: true }).click();
    await expect(canvas).toHaveAttribute('data-world-sector', '17');
    if (transport === 'socket') await expect.poll(() => socketConnected).toBe(true);
    await page.screenshot({ path: info.outputPath('rival-outskirts-arrival.png'), fullPage: true, animations: 'disabled' });
    const exit = sectorExits(17).find(e => e.destinationSector === 24)!;
    for (const sector of [exit.destinationSector, 17]) {
        const road = page.getByRole('button', { name: `Cross to ${sectorName(sector)}`, exact: true });
        await road.focus(); await road.press('Enter');
        await expect(canvas).toHaveAttribute('data-world-sector', String(sector), { timeout: 90_000 });
        await canvas.focus(); await page.keyboard.press('Escape');
        await expect.poll(async () => (await (await request.get('/api/player/world-move', { headers })).json()).sector).toBe(sector);
    }
    const approach = board.locator('.continuous-world-tile').nth(102);
    await approach.focus(); await approach.press('Enter');
    await expect(page.getByRole('button', { name: 'Current tile row 9 column 7', exact: true })).toHaveCount(1);
    const gate = page.getByRole('button', { name: 'View Moonshadow Village raid options', exact: true });
    await gate.click();
    const defenses = page.getByRole('dialog', { name: 'Moonshadow Village defenses', exact: true });
    await expect(defenses).toBeVisible();
    await expect(defenses).toContainText('defend in PvP');
    await expect(defenses).toContainText('AI garrison');
    await expect(defenses).toContainText('field mission');
    await page.screenshot({ path: info.outputPath('rival-village-defenses.png'), fullPage: true, animations: 'disabled' });
    const raidStart = page.waitForResponse(response => response.url().endsWith('/api/missions/raid-start') && response.request().method() === 'POST');
    const fightStart = page.waitForResponse(response => response.url().endsWith('/api/missions/ai-fight-start')
        && response.request().method() === 'POST' && response.request().postDataJSON().battleKind === 'raidAi');
    await defenses.getByRole('button', { name: 'Raid village garrison', exact: true }).click();
    const raidResponse = await raidStart, fightResponse = await fightStart;
    expect(raidResponse.status(), await raidResponse.text()).toBe(200);
    expect(raidResponse.request().postDataJSON().sector).toBe(17);
    expect(fightResponse.status(), await fightResponse.text()).toBe(200);
    const fight = await fightResponse.json();
    expect(fight.sector).toBe(17);
    expect(fight.battleKind).toBe('raidAi');
    const arena = page.locator('.mission-arena-fight');
    await expect(arena).toBeVisible();
    await expect(defenses).toHaveCount(0);
    const action = page.waitForResponse(response => response.url().endsWith('/api/solo-pve/action') && response.request().method() === 'POST');
    await arena.getByRole('button', { name: /Wait.*End turn/ }).click();
    const actionResponse = await action;
    expect(actionResponse.status(), await actionResponse.text()).toBe(200);
    const resume = page.waitForResponse(response => response.url().endsWith('/api/missions/ai-fight-start')
        && response.request().method() === 'POST' && response.request().postDataJSON().resumeAiFight === true);
    await page.reload({ waitUntil: 'domcontentloaded' });
    const resumedResponse = await resume;
    expect(resumedResponse.status(), await resumedResponse.text()).toBe(200);
    const resumedFight = await resumedResponse.json();
    expect(resumedFight.sessionId).toBe(fight.sessionId);
    await expect(arena).toBeVisible();
    // End this player's own battle through the normal authenticated command,
    // including its server-owned retreat cost, then exercise the UI return.
    const abandoned = await request.post('/api/solo-pve/action', { headers, data: {
        playerName: name, sessionId: fight.sessionId, expectedVersion: resumedFight.session.version,
        moveToken: `outskirts-abandon-${name}`, type: 'abandon',
    } });
    expect(abandoned.status(), await abandoned.text()).toBe(200);
    // Recover the terminal result as a reconnecting player would.
    await page.reload({ waitUntil: 'domcontentloaded' });
    const result = page.getByRole('dialog', { name: 'Fight ended', exact: true });
    await expect(result).toBeVisible();
    await result.getByRole('button', { name: 'Return', exact: true }).click();
    await expect(arena).toHaveCount(0);
    await expect(board).toHaveAttribute('aria-busy', 'false', { timeout: 60_000 });
    await expect(defenses).toHaveCount(0);
    await expect(canvas).toHaveAttribute('data-world-sector', '17');
    const onward = board.locator('.continuous-world-tile').nth(101);
    await onward.focus(); await onward.press('Enter');
    await expect(page.getByRole('button', { name: 'Current tile row 9 column 6', exact: true })).toHaveCount(1);
    expect((await (await request.get('/api/player/world-move', { headers })).json()).sector).toBe(17);
    expect(errors).toEqual([]);
    await writeFile(info.outputPath('rival-outskirts.json'), JSON.stringify({ transport, socketConnected, sessionId: fight.sessionId, arrival: await admitted.json(), final: await (await request.get('/api/player/world-move', { headers })).json(), errors }, null, 2));
});
