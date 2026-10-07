import { expect } from '@playwright/test';
import { test } from './helpers/reconnecting-request';
import { uiAuditSave } from '../e2e/helpers/ui-audit-runtime';
import { uniquePlayerName } from './helpers/player-names';
import { quietRoadCooldowns } from './helpers/quiet-road';
import { LATEST_PATCH_NOTE } from '../src/data/patch-notes';
import { sectorExits } from '../../shared/sector-links';
import { sectorName } from '../../shared/sector-geo';
import { writeFile } from 'node:fs/promises';

test.use({ contextOptions: { reducedMotion: 'no-preference' }, video: 'on' });
for (const transport of ['socket', 'http'] as const) test(`continuous camera crosses a real road and restores accepted position (${transport})`, async ({ page, request, context }, info) => {
    test.setTimeout(180_000);
    if (transport === 'http') await context.route('**/socket.io/**', route => route.abort());
    const name = uniquePlayerName(stamp => `continuous${stamp}`);
    const registered = await request.post('/api/player-auth', { data: { action: 'register', name, password: 'ContinuousJourney!1234' } });
    expect(registered.status(), await registered.text()).toBe(200);
    const token = String((await registered.json()).token), headers = { 'x-player-name': name, 'x-player-token': token };
    const save = uiAuditSave(); save.currentSector = 9; save.currentTile = 102; save.worldGeoV = 2; save.currentBiome = 'forest';
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
    }, { name, token, canonical, patch: LATEST_PATCH_NOTE.version });
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    async function openWorld() {
        await page.goto('/#/worldMap', { waitUntil: 'domcontentloaded' });
        const shell = page.locator('.app-shell[data-screen="worldMap"]'), enter = page.getByRole('button', { name: 'Enter World Map', exact: true });
        await expect(shell.or(enter)).toBeVisible({ timeout: 60_000 }); if (await enter.isVisible()) await enter.click();
        const returnButton = page.getByRole('button', { name: /Return to Sector \d+\b/ });
        await expect.poll(async () => await returnButton.isVisible() || await page.locator('.continuous-world-map').isVisible()).toBe(true);
        if (await returnButton.isVisible()) await returnButton.click();
        await expect(page.locator('.continuous-world-map')).toHaveAttribute('aria-busy', 'false');
    }
    await openWorld();
    const canvas = page.locator('.continuous-world-map > canvas');
    await expect(canvas).toHaveAttribute('data-world-sector', '9');
    await page.screenshot({ path: info.outputPath('continuous-start.png'), fullPage: true });
    await canvas.evaluate(element => {
        const frames: { x: number; y: number; sector: string; at: number }[] = [];
        (window as unknown as { continuousFrames: typeof frames }).continuousFrames = frames;
        const sample = (at: number) => { const c = element as HTMLCanvasElement; frames.push({ x: Number(c.dataset.worldX), y: Number(c.dataset.worldY), sector: c.dataset.worldSector!, at }); if (element.isConnected && frames.length < 8000) requestAnimationFrame(sample); };
        requestAnimationFrame(sample);
    });
    const exit = sectorExits(9).find(e => e.destinationSector === 15)!;
    const button = page.getByRole('button', { name: `Cross to ${sectorName(exit.destinationSector)}`, exact: true });
    await button.focus(); await button.press('Enter');
    await expect.poll(async () => (await (await request.get('/api/player/world-move', { headers })).json()).worldPosition?.from.startsWith('road:'), { timeout: 60_000 }).toBe(true);
    await page.screenshot({ path: info.outputPath('continuous-corridor.png'), fullPage: true });
    await expect(canvas).toHaveAttribute('data-world-sector', '15', { timeout: 90_000 });
    await expect(page.locator('[data-world-self]')).toHaveCount(1);
    await canvas.focus(); await page.keyboard.press('Escape');
    await expect.poll(async () => (await (await request.get('/api/player/world-move', { headers })).json()).sector).toBe(15);
    let previousCursor = '';
    await expect.poll(async () => { const next = JSON.stringify((await (await request.get('/api/player/world-move', { headers })).json()).worldPosition);
        const stable = previousCursor === next; previousCursor = next; return stable; }, { intervals: [500] }).toBe(true);
    const accepted = await (await request.get('/api/player/world-move', { headers })).json();
    const frames = await page.evaluate(() => (window as unknown as { continuousFrames: { x: number; y: number; sector: string; at: number }[] }).continuousFrames);
    const steps = frames.slice(1).map((frame, i) => Math.hypot(frame.x - frames[i]!.x, frame.y - frames[i]!.y));
    expect(Math.max(...steps)).toBeLessThan(.34);
    expect(Number(await canvas.getAttribute('data-decoded-maps'))).toBeLessThanOrEqual(8);
    await page.screenshot({ path: info.outputPath('continuous-boundary.png'), fullPage: true });
    await openWorld(); await expect(canvas).toHaveAttribute('data-world-sector', '15');
    expect((await (await request.get('/api/player/world-move', { headers })).json()).worldPosition).toEqual(accepted.worldPosition);
    expect(errors).toEqual([]);
    await writeFile(info.outputPath('continuous-world.json'), JSON.stringify({ accepted, frames, maximumStep: Math.max(...steps), errors }, null, 2));
});
