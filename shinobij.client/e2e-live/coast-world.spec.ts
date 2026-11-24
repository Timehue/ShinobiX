import { expect, type BrowserContext, type APIRequestContext } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from './helpers/reconnecting-request';
import { openWorld, seedWorldActor } from './helpers/world-actor';
import { coastWalkSpace, sectorPositionModel } from '../../api/_coast-walk-space';
import { coastPatrolsIn } from '../../api/coast/_patrols';
import { coastExits, coastLayout } from '../../shared/coast-world';
import { buildWorldNavigation } from '../../shared/continuous-world-navigation';
import type { WorldPosition } from '../../shared/world-position';

test.use({ contextOptions: { reducedMotion: 'no-preference' } });
const model = sectorPositionModel(101);
const charter = { v: 1, active: {}, done: { 'shuttered-boat': { at: 1, marks: 1, opensRegion: 1, unlocks: ['boat'] } } };
async function actor(request: APIRequestContext, context: BrowserContext, position: WorldPosition, equipped = false) {
    const content = process.env.SECTOR_MODEL_TEST_CONTENT, playerFolder = process.env.COAST_QA_PLAYER_CONTENT;
    const receipt = equipped && playerFolder ? JSON.parse(await readFile(join(playerFolder, 'result.json'), 'utf8')).model : undefined;
    if (content) await context.route('https://coast-art.example.invalid/sector-models/**', async route => {
        const relative = new URL(route.request().url()).pathname.split('/').slice(2);
        if (!relative.every(part => /^[a-z0-9.-]+$/i.test(part) && part !== '..')) return route.abort();
        const root = relative[0] === 'players' && playerFolder ? join(playerFolder, 'sector-models') : content;
        const file = join(root, ...relative);
        const bytes = await readFile(file).catch(() => null);
        return route.fulfill({ status: bytes ? 200 : 404, body: bytes ?? '', headers: { 'access-control-allow-origin': '*',
            'content-type': file.endsWith('.json') ? 'application/json' : 'image/webp' } });
    });
    let equippedManifestLoaded = false;
    if (receipt) context.on('response', response => {
        if (response.ok() && response.url().endsWith('/players/' + receipt.assetId + '/' + receipt.version + '.json')) equippedManifestLoaded = true;
    });
    const seeded = await seedWorldActor(request, context, position, model.location(position), { questLines: charter,
        character: { level: 85, starterWorldModel: 'starter-two', ...(receipt ? { playerModel: { assetId: receipt.assetId, version: receipt.version } } : {}) } });
    return { ...seeded, equippedManifestLoaded: () => equippedManifestLoaded };
}
test('walk the coast roads, resume, refuse a closed region and sail home', async ({ page, request, context }, info) => {
    test.setTimeout(420_000);
    const [patrolStart] = coastPatrolsIn(104, Date.now());
    const driver = await actor(request, context, model.fallback(104, patrolStart.tile)!, true);
    await openWorld(page);
    const canvas = page.locator('.continuous-world-map > canvas[tabindex]');
    const self = page.locator('[data-world-self] .sector-model-figure');
    const shot = (name: string) => page.screenshot({ path: info.outputPath(name + '.png') });
    const infoButton = page.getByRole('button', { name: /^Sector info/ });
    const cross = async (to: number) => {
        const from = Number(await canvas.getAttribute('data-world-sector'));
        const trail = coastExits(from).find(exit => exit.destinationSector === to)!;
        const road = page.getByRole('button', { name: 'Follow the ' + trail.direction + ' trail', exact: true });
        await road.press('Enter');
        await canvas.scrollIntoViewIfNeeded();
    };
    const snapshot = async () => (await (await request.get('/api/player/world-move', { headers: driver.headers })).json());
    await expect(canvas).toHaveAttribute('data-world-sector', '104');

    const patrol = page.getByRole('button', { name: /^Challenge / }).first();
    await expect(patrol).toBeVisible();
    const footing = await patrol.getAttribute('style');
    await expect.poll(() => patrol.getAttribute('style')).not.toBe(footing);
    if (process.env.SECTOR_MODEL_TEST_CONTENT) {
        await expect(patrol).toHaveClass(/has-sector-model/, { timeout: 45_000 });
        await expect(patrol.locator('.sector-model-figure')).toHaveAttribute('data-gait', 'walk');
    }
    await expect(patrol).toBeInViewport();
    if (process.env.COAST_QA_PLAYER_CONTENT) await expect.poll(driver.equippedManifestLoaded).toBe(true);
    await shot('sector-104');
    await shot('patrol-walking');
    await cross(103);
    if (process.env.SECTOR_MODEL_TEST_CONTENT) {
        await expect(self).toHaveAttribute('data-gait', 'walk');
        await expect(self).toHaveAttribute('data-clip', /walk|stride|loop|start/);
        await shot('player-walking');
        await page.getByRole('button', { name: 'Run', exact: true }).click();
        await expect(self).toHaveAttribute('data-gait', 'run');
        await shot('player-running');
    }
    await expect.poll(async () => (await snapshot()).worldPosition.from, { timeout: 60_000 }).toMatch(/^road:|^l:/);
    const before = await snapshot();
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(canvas).toHaveAttribute('data-world-sector', String(before.sector), { timeout: 45_000 });
    const after = await snapshot();
    expect(model.distanceWithin(before.worldPosition, after.worldPosition, 3)).not.toBeNull();
    await shot('refresh-mid-walk');
    if (after.sector !== 103) await cross(103);
    await expect(canvas).toHaveAttribute('data-world-sector', '103', { timeout: 90_000 });
    await shot('sector-103');
    await cross(102);
    await expect(canvas).toHaveAttribute('data-world-sector', '102', { timeout: 90_000 });
    await shot('sector-102');
    await cross(101);
    await expect(canvas).toHaveAttribute('data-world-sector', '101', { timeout: 120_000 });
    await shot('sector-101');
    await cross(111);
    await expect(page.getByText('That region of the coast is not open to you yet.')).toBeVisible({ timeout: 120_000 });
    expect((await snapshot()).sector).toBe(101);
    await shot('locked-region');
    await infoButton.click();
    const dock = Object.values(coastLayout(101)!.sites).find(site => site.actions.includes('boat-crossing'))!;
    await page.getByRole('button', { name: dock.verb + ' ' + dock.name, exact: true }).click();
    const sail = page.getByRole('button', { name: 'Sail home to the Western Piers' });
    await expect(sail).toBeVisible({ timeout: 120_000 });
    await sail.click();
    await expect(canvas).toHaveAttribute('data-world-sector', '7', { timeout: 45_000 });
    await shot('boat-home');
});
test('both players see across the seam', async ({ context, browser, request, page }, info) => {
    const graph = buildWorldNavigation(coastWalkSpace);
    const a = graph.nodes.find(n => n.road === '101-102' && n.sector === 101 && n.neighbors.some(id => graph.byId.get(id)?.sector === 102))!;
    const b = a.neighbors.find(id => graph.byId.get(id)?.sector === 102)!;
    const point = (id: string) => ({ layoutVersion: coastWalkSpace.layoutVersion, from: id, to: id, progress: 0 });
    const other = await browser.newContext({ baseURL: info.project.use.baseURL, viewport: info.project.use.viewport, isMobile: info.project.use.isMobile, hasTouch: info.project.use.hasTouch, reducedMotion: 'no-preference' });
    try {
        const first = await actor(request, context, point(a.id)), second = await actor(request, other, point(b));
        const peer = await other.newPage();
        await openWorld(page); await openWorld(peer);
        await expect(page.locator('.continuous-world-peer').getByText(second.name, { exact: true })).toBeVisible();
        await expect(peer.locator('.continuous-world-peer').getByText(first.name, { exact: true })).toBeVisible();
        await page.screenshot({ path: info.outputPath('neighbour-101.png') });
        await peer.screenshot({ path: info.outputPath('neighbour-102.png') });
        const canvas = page.locator('.continuous-world-map > canvas[tabindex]');
        await canvas.scrollIntoViewIfNeeded();
        const far = graph.byId.get(b)!;
        const target = await canvas.evaluate((element, delta) => {
            const self = element.parentElement!.querySelector('[data-world-self]')!;
            const feet = self.getBoundingClientRect();
            const size = parseFloat(getComputedStyle(self).getPropertyValue('--world-tile-px'));
            return { x: feet.x + feet.width / 2 + delta.x * size, y: feet.bottom + delta.y * size };
        }, { x: far.x - a.x, y: far.y - a.y });
        if (info.project.use.hasTouch) await page.touchscreen.tap(target.x, target.y);
        else await page.mouse.click(target.x, target.y);
        await expect(canvas).toHaveAttribute('data-world-sector', '102');
    } finally { await other.close(); }
});
test('the starter and residents walk at the Stair Houses', async ({ page, context, request }, info) => {
    const site = coastLayout(105)!.sites['saltstair-houses-105'];
    await actor(request, context, model.fallback(105, site.approach)!);
    await openWorld(page);
    await page.getByRole('button', { name: 'Enter ' + site.name, exact: true }).first().click();
    const room = page.locator('.stairs-street .coast-room-board');
    await expect(room).toBeVisible();
    const resident = room.locator('.stairs-person').first(), position = await resident.getAttribute('style');
    await expect.poll(() => resident.getAttribute('style')).not.toBe(position);
    await page.screenshot({ path: info.outputPath('stair-houses-resident.png') });
    if (process.env.SECTOR_MODEL_TEST_CONTENT) {
        const figure = room.locator('.stairs-player .sector-model-figure');
        await room.focus(); await page.keyboard.down('ArrowUp');
        await expect(figure).toHaveAttribute('data-gait', 'walk');
        await page.screenshot({ path: info.outputPath('starter-walking.png') });
        await page.keyboard.up('ArrowUp');
        const run = page.getByRole('button', { name: 'Run', exact: true });
        await run.click();
        await expect(run).toHaveAttribute('data-run-state', 'running');
        await room.getByRole('button', { name: 'Cook house', exact: true }).click();
        await expect(figure).toHaveAttribute('data-gait', 'run');
        await page.screenshot({ path: info.outputPath('starter-running.png') });
    }
});
