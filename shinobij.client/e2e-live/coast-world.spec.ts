import { expect, type BrowserContext, type APIRequestContext, type Page } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { test } from './helpers/reconnecting-request';
import { openWorld, seedWorldActor } from './helpers/world-actor';
import { uiAuditSave } from '../e2e/helpers/ui-audit-runtime';
import { takeCoastTrail } from './helpers/coast-walk';
import { coastWalkSpace, sectorPositionModel } from '../../api/_coast-walk-space';
import { coastPatrolsIn } from '../../api/coast/_patrols';
import { resourceNode } from '../../shared/resource-nodes';
import { COAST_DOCK, COAST_WORLD, coastExits, coastLayout } from '../../shared/coast-world';
import { buildWorldNavigation } from '../../shared/continuous-world-navigation';
import type { WorldPosition } from '../../shared/world-position';

test.use({ contextOptions: { reducedMotion: 'no-preference' } });
const model = sectorPositionModel(101);
const charter = { v: 1, active: {}, done: { 'shuttered-boat': { at: 1, marks: 1, opensRegion: 1, unlocks: ['boat'] } } };
const unlockedCoast = { ...charter, done: { ...charter.done,
    'crossing-war-1': { at: 3, marks: 2, opensRegion: 2, unlocks: ['contest-land'] },
    'crossing-war-2': { at: 4, marks: 2, opensRegion: 3 },
    'crossing-war-3': { at: 5, marks: 3, opensRegion: 4 },
    'crossing-war-4': { at: 12, marks: 3, opensRegion: 5 },
    'crossing-war-5': { at: 14, marks: 4, unlocks: ['last-garrison'] } } };

function watchMovement(page: Page) {
    const recent: { ok: boolean; reason?: string; sequence?: number; sector?: number; worldPosition?: WorldPosition }[] = [];
    const record = (reply: typeof recent[number]) => {
        if (typeof reply?.ok !== 'boolean' || !(reply.reason || reply.worldPosition)) return;
        const { ok, reason, sequence, sector, worldPosition } = reply;
        recent.push({ ok, reason, sequence, sector, worldPosition });
        if (recent.length > 100) recent.shift();
    };
    page.on('websocket', socket => socket.on('framereceived', ({ payload }) => {
        if (typeof payload === 'string' && /^43\d*\[/.test(payload)) {
            record(JSON.parse(payload.slice(payload.indexOf('[')))[0]);
        }
    }));
    page.on('response', response => {
        if (new URL(response.url()).pathname === '/api/player/world-move') void response.json().then(record).catch(() => {});
    });
    return recent;
}

async function expectSavedArrival(request: APIRequestContext, headers: Record<string, string>, target: string) {
    await expect.poll(async () => {
        const reply = await request.get('/api/player/world-move', { headers });
        const position: WorldPosition | undefined = (await reply.json()).worldPosition;
        return position?.from === target && position.progress === 0 || position?.to === target && position.progress === 1;
    }, { message: 'Server confirms arrival at ' + target, timeout: 120_000, intervals: [1000, 2000, 4000] }).toBe(true);
}

// Long release walkthrough. Each directed trail is used once, on one account, starting and ending at the slip.
if (process.env.COAST_FULL_WALK === '1') test('walk every coast trail in both directions', async ({ page, request, context }, info) => {
    test.setTimeout(3 * 60 * 60_000);
    const start = model.fallback(COAST_DOCK.sector, COAST_DOCK.tile)!;
    const driver = await actor(request, context, start, { veteran: true });
    const replies = watchMovement(page);
    const remaining = new Map(coastWalkSpace.chunks.map(({ sector }) => [sector, [...coastExits(sector)]]));
    const stack = [COAST_DOCK.sector], tour: number[] = [];
    while (stack.length) {
        const next = remaining.get(stack.at(-1)!)!.pop();
        if (next) stack.push(next.destinationSector);
        else tour.push(stack.pop()!);
    }
    tour.reverse();
    expect(tour.length).toBe(2 * COAST_WORLD.roads.length + 1);
    await openWorld(page);
    const canvas = page.locator('.continuous-world-map > canvas[tabindex]');
    const visited = new Set<number>();
    let tile = COAST_DOCK.tile;
    for (const [index, to] of tour.slice(1).entries()) {
        const from = tour[index], trail = coastExits(from).find(exit => exit.destinationSector === to)!;
        await test.step(`Trail ${index + 1}: ${from} to ${to}`, async () => {
            await expect(canvas).toHaveAttribute('data-world-sector', String(from));
            await takeCoastTrail(page, tile, trail, !!info.project.use.hasTouch);
            await expect(canvas).toHaveAttribute('data-world-sector', String(to), { timeout: 180_000 });
            await expectSavedArrival(request, driver.headers, `${to}:${trail.destinationTile}`);
            if (!visited.has(to)) await page.screenshot({ path: info.outputPath(`sector-${to}.png`) });
            visited.add(to);
            tile = trail.destinationTile;
            console.log(`Walked ${index + 1}/${tour.length - 1}: ${from} to ${to}, arrived at tile ${trail.destinationTile}.`);
        }).catch(async error => {
            const path = info.outputPath('last-movement-replies.json');
            await writeFile(path, JSON.stringify(replies));
            await info.attach('last-movement-replies', { path, contentType: 'application/json' });
            throw error;
        });
    }
    expect(visited.size).toBe(coastWalkSpace.chunks.length);
    expect(tour.at(-1)).toBe(COAST_DOCK.sector);
});

for (const [from, entryTile, to, title] of [
    [102, 49, COAST_DOCK.sector, 'follow the painted return trail from the west entrance to the landing'],
    [136, 123, 139, 'walk the painted road past the Cinder Assay patrols'],
] as const) test(title, async ({ page, request, context }, info) => {
    test.setTimeout(240_000);
    const trail = coastExits(from).find(exit => exit.destinationSector === to)!;
    const driver = await actor(request, context, model.fallback(from, entryTile)!, { veteran: true });
    const replies = watchMovement(page);
    await openWorld(page);
    const canvas = page.locator('.continuous-world-map > canvas[tabindex]');
    await expect(canvas).toHaveAttribute('data-world-sector', String(from));
    try {
        await takeCoastTrail(page, entryTile, trail, !!info.project.use.hasTouch);
        await expect(canvas).toHaveAttribute('data-world-sector', String(trail.destinationSector), { timeout: 90_000 });
        await expectSavedArrival(request, driver.headers, `${trail.destinationSector}:${trail.destinationTile}`);
        await page.screenshot({ path: info.outputPath(`arrived-${to}.png`) });
        console.log(`Confirmed crossing on ${info.project.name}: ${from} to ${to}, arrived at tile ${trail.destinationTile}.`);
    } finally {
        await info.attach('last-movement-replies', { body: JSON.stringify(replies), contentType: 'application/json' });
    }
});

test('choose between two southward trails at their painted road ends', async ({ page, request, context }, info) => {
    const start = model.fallback(131, 140)!;
    await actor(request, context, start, { veteran: true });
    await openWorld(page);
    const canvas = page.locator('.continuous-world-map > canvas[tabindex]');
    await expect(canvas).toHaveAttribute('data-world-sector', '131');
    const history = await canvas.evaluateHandle(element => {
        const sectors = new Set([element.getAttribute('data-world-sector')]);
        new MutationObserver(() => sectors.add(element.getAttribute('data-world-sector')))
            .observe(element, { attributes: true, attributeFilter: ['data-world-sector'] });
        return sectors;
    });
    const trail = coastExits(131).find(exit => exit.destinationSector === 133)!;
    await expect(page.getByRole('button', { name: /^Follow the south trail to / })).toHaveCount(2);
    await page.screenshot({ path: info.outputPath('painted-trailheads.png') });
    await takeCoastTrail(page, 140, trail, !!info.project.use.hasTouch);
    await expect(canvas).toHaveAttribute('data-world-sector', '133', { timeout: 120_000 });
    expect(await history.evaluate(sectors => Array.from(sectors))).toEqual(['131', '133']);
    await page.screenshot({ path: info.outputPath('direct-trail-133.png') });
});
async function actor(request: APIRequestContext, context: BrowserContext, position: WorldPosition, { equipped, veteran }: { equipped?: boolean; veteran?: boolean } = {}) {
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
    const seeded = await seedWorldActor(request, context, position, model.location(position), { questLines: veteran ? unlockedCoast : charter,
        ...(veteran ? { triggeredEvents: [...uiAuditSave().triggeredEvents as string[],
            'story-interlude-ashen-leaf-village-88', 'story-interlude-ashen-leaf-village-92'] } : {}),
        character: { level: veteran ? 100 : 85, starterWorldModel: 'starter-two', ...(receipt ? { playerModel: { assetId: receipt.assetId, version: receipt.version } } : {}) } });
    return { ...seeded, equippedManifestLoaded: () => equippedManifestLoaded };
}
test('walk the coast roads, resume, refuse a closed region and sail home', async ({ page, request, context }, info) => {
    test.setTimeout(420_000);
    const [patrolStart] = coastPatrolsIn(104, Date.now());
    const driver = await actor(request, context, model.fallback(104, patrolStart.tile)!, { equipped: true });
    await openWorld(page);
    const canvas = page.locator('.continuous-world-map > canvas[tabindex]');
    const self = page.locator('[data-world-self] .sector-model-figure');
    const shot = (name: string) => page.screenshot({ path: info.outputPath(name + '.png') });
    const infoButton = page.getByRole('button', { name: /^Sector info/ });
    const cross = async (to: number) => {
        const from = Number(await canvas.getAttribute('data-world-sector'));
        const trail = coastExits(from).find(exit => exit.destinationSector === to)!;
        const road = page.getByRole('button', { name: 'Follow the ' + trail.direction + ' trail to ' + coastLayout(to)!.name, exact: true });
        await road.press('Enter');
        await canvas.scrollIntoViewIfNeeded();
    };
    const snapshot = async () => (await (await request.get('/api/player/world-move', { headers: driver.headers })).json());
    await expect(canvas).toHaveAttribute('data-world-sector', '104');

    const patrol = page.getByRole('button', { name: /^Inspect .*Level / }).first();
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
    await patrol.press('Enter');
    const encounter = page.getByRole('dialog').filter({ has: page.getByRole('button', { name: 'Observe', exact: true }) });
    await encounter.getByRole('button', { name: 'Observe' }).click();
    await expect(encounter.getByRole('status')).toBeVisible();
    await encounter.getByRole('button', { name: 'Leave', exact: true }).click();
    await expect(canvas).toHaveAttribute('data-world-sector', '104');
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
for (const equipped of [false, true]) test(equipped ? 'the equipped Make Model walks and runs at the Stair Houses'
    : 'the starter and residents walk at the Stair Houses', async ({ page, context, request }, info) => {
    test.skip(equipped && !(process.env.COAST_QA_PLAYER_CONTENT && process.env.SECTOR_MODEL_TEST_CONTENT),
        'This walkthrough uses the owned model receipt and its fitted pages.');
    const site = coastLayout(105)!.sites['saltstair-houses-105'];
    const driver = await actor(request, context, model.fallback(105, site.approach)!, { equipped });
    // A room regression that falls back to the starter must not pass the owned-model gait checks.
    if (equipped) await context.route('**/sector-models/starter-two/**', route => route.abort());
    await openWorld(page);
    await page.getByRole('button', { name: 'Enter ' + site.name, exact: true }).first().click();
    const room = page.locator('.stairs-street .coast-room-board');
    await expect(room).toBeVisible();
    const resident = room.locator('.stairs-person').first(), position = await resident.getAttribute('style');
    await expect.poll(() => resident.getAttribute('style')).not.toBe(position);
    await page.screenshot({ path: info.outputPath('stair-houses-resident.png') });
    if (process.env.SECTOR_MODEL_TEST_CONTENT) {
        const figure = room.locator('.stairs-player .sector-model-figure');
        await expect(figure).toBeVisible();
        if (equipped) await expect.poll(driver.equippedManifestLoaded).toBe(true);
        const floor = (await room.boundingBox())!;
        const plaza = { position: { x: floor.width * 6.5 / 12, y: floor.height * 5.5 / 12 } };
        if (info.project.use.hasTouch) await room.tap(plaza); else await room.click(plaza);
        await expect(figure).toHaveAttribute('data-gait', 'walk');
        await page.screenshot({ path: info.outputPath(equipped ? 'make-model-walking.png' : 'starter-walking.png') });
        await expect(room).toHaveAttribute('data-tile', '66');
        await expect(figure).toHaveAttribute('data-gait', 'idle');
        const run = room.getByRole('button', { name: 'Run', exact: true });
        const control = (await run.boundingBox())!;
        expect(control.width).toBeGreaterThanOrEqual(44);
        expect(control.width).toBeLessThanOrEqual(48);
        expect(control.height).toBe(control.width);
        const standing = await room.getAttribute('data-tile');
        if (info.project.use.hasTouch) await run.tap(); else await run.click();
        await expect(run).toHaveAttribute('data-run-state', 'running');
        await expect(room).toHaveAttribute('data-tile', standing!);
        const tiles = await room.evaluate(async element => {
            const floor = element as HTMLElement;
            const before = Number(floor.dataset.tile);
            const bounds = floor.getBoundingClientRect();
            // Three choices of the same patch of ground beside the well, before
            // the next paint. Keep the destination on the street to see the run.
            for (let tap = 0; tap < 3; tap++) floor.dispatchEvent(new MouseEvent('click', {
                bubbles: true, clientX: bounds.x + bounds.width * 2.5 / 12, clientY: bounds.y + bounds.height * 8.5 / 12
            }));
            await new Promise(requestAnimationFrame);
            return [before, Number(floor.dataset.tile)];
        });
        expect(Math.abs(tiles[0] % 12 - tiles[1] % 12) +
            Math.abs(Math.floor(tiles[0] / 12) - Math.floor(tiles[1] / 12))).toBeLessThanOrEqual(1);
        await expect(figure).toHaveAttribute('data-gait', 'run');
        await page.screenshot({ path: info.outputPath(equipped ? 'make-model-running.png' : 'starter-running.png') });
    }
});

test('the painted starter fits the Boatwright’s Slip room in 2D mode', async ({ page, context, request }, info) => {
    const slip = coastLayout(101)!.sites['saltstair-dock-101'];
    for (const kind of ['starter-one', 'starter-two']) {
        const pose = '/world-figures/v1/' + kind + '.webp';
        const legacy = await request.get('/coast-map/residents/' + kind + '.webp', { maxRedirects: 0 });
        expect(legacy.status()).toBe(302);
        expect(legacy.headers().location).toBe(pose);
        expect((await request.get(pose)).headers()['content-type']).toContain('image/webp');
    }
    await context.addInitScript(() => localStorage.setItem('worldAvatarMode.v1', '2d'));
    await actor(request, context, model.fallback(101, slip.approach)!);
    await openWorld(page);
    await page.getByRole('button', { name: slip.verb + ': ' + slip.name, exact: true }).press('Enter');
    await page.getByRole('button', { name: 'Enter ' + slip.name, exact: true }).click();
    const room = page.locator('.coast-room-board');
    const sprite = room.locator('.stairs-player > img');
    await expect(sprite).toBeVisible();
    await expect.poll(() => sprite.evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    const pose = await sprite.evaluate(image => {
        const rect = image.getBoundingClientRect();
        return { scale: rect.height / image.closest('.coast-room-board')!.clientWidth,
            feet: rect.bottom - image.parentElement!.getBoundingClientRect().bottom };
    });
    expect(pose.scale).toBeCloseTo(.22, 2);
    expect(Math.abs(pose.feet)).toBeLessThan(1);
    await page.screenshot({ path: info.outputPath('boatwright-room-2d.png') });
});

for (const fitted of [false, true]) test('the street roof hides a passing figure and clears the front of the shop (' +
    (fitted ? 'fitted model' : '2D') + ')', async ({ page, context, request }, info) => {
    test.skip(fitted && !process.env.SECTOR_MODEL_TEST_CONTENT, 'The fitted model needs the published model pages.');
    const houses = coastLayout(105)!.sites['saltstair-houses-105'];
    if (!fitted) await context.addInitScript(() => localStorage.setItem('worldAvatarMode.v1', '2d'));
    await actor(request, context, model.fallback(105, houses.approach)!);
    await openWorld(page);
    await page.getByRole('button', { name: 'Enter ' + houses.name, exact: true }).first().click();
    const room = page.locator('.stairs-street .coast-room-board');
    const sprite = room.locator('.stairs-player > img');
    const figure = room.locator('.stairs-player .sector-model-figure');
    if (fitted) await expect(figure).toBeVisible(); else await expect(sprite).toBeVisible();
    await expect.poll(() => sprite.evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    const playerAnchor = room.locator('.stairs-player');
    async function stand(tile: number) {
        await room.scrollIntoViewIfNeeded();
        // WebKit can finish a short stride before the tap returns to Playwright.
        // Record the rendered gait from before the input, including that first frame.
        const stride = fitted ? await figure.evaluateHandle(element => {
            const seen = { walk: false };
            const observer = new MutationObserver(changes => {
                if (element.getAttribute('data-gait') === 'walk' || changes.some(change => change.oldValue === 'walk')) {
                    seen.walk = true;
                    observer.disconnect();
                }
            });
            observer.observe(element, { attributes: true, attributeFilter: ['data-gait'], attributeOldValue: true });
            return seen;
        }) : null;
        // A resident can be on the tile. Choose exposed ground so a tap means
        // "walk here" instead of starting the resident's conversation.
        const openGround = () => room.evaluate((floor, tile) => {
            const board = floor.getBoundingClientRect(), cell = board.width / 12;
            for (const dy of [0, -.28, .28]) for (const dx of [0, -.28, .28]) {
                const x = board.x + (tile % 12 + .5 + dx) * cell;
                const y = board.y + (Math.floor(tile / 12) + .5 + dy) * cell;
                if ([[-5, -5], [5, -5], [-5, 5], [5, 5]].every(([i, j]) => document.elementFromPoint(x + i, y + j) === floor))
                    return { x, y };
            }
            return null;
        }, tile);
        await expect(async () => {
            const point = await openGround();
            if (!point) throw new Error('Waiting for a resident to clear the street tile');
            await room.evaluate(floor => {
                floor.removeAttribute('data-test-ground-tap');
                floor.addEventListener('click', event => floor.setAttribute('data-test-ground-tap', String(event.target === floor)),
                    { capture: true, once: true });
            });
            if (info.project.use.hasTouch) await page.touchscreen.tap(point.x, point.y); else await page.mouse.click(point.x, point.y);
            expect(await room.getAttribute('data-test-ground-tap'), 'The tap reached the walkable ground').toBe('true');
        }).toPass({ timeout: 20_000 });
        if (stride) {
            await expect.poll(() => stride.evaluate(seen => seen.walk)).toBe(true);
            await stride.dispose();
        }
        await expect(room).toHaveAttribute('data-tile', String(tile));
        await expect.poll(async () => {
            return playerAnchor.evaluate((element, tile) => {
                const board = element.parentElement!.getBoundingClientRect(), feet = element.getBoundingClientRect();
                return Math.hypot(feet.x - board.x - (tile % 12 + .5) * board.width / 12,
                    feet.y - board.y - (Math.floor(tile / 12) + .5) * board.height / 12);
            }, tile);
        }).toBeLessThan(2);
    }
    async function roofCoverage() {
        const clip = (await sprite.boundingBox())!;
        const still = '.stairs-person {visibility:hidden!important}';
        const pixels = async (style: string) => sharp(await page.screenshot({ clip, style })).removeAlpha().raw().toBuffer();
        const displayed = await pixels(still);
        const uncovered = await pixels(still + '.street-layer.shops {visibility:hidden!important}');
        let different = 0;
        for (let i = 0; i < displayed.length; i += 3) {
            if (Math.abs(displayed[i] - uncovered[i]) + Math.abs(displayed[i + 1] - uncovered[i + 1]) +
                Math.abs(displayed[i + 2] - uncovered[i + 2]) > 40) different++;
        }
        return different;
    }
    const record = fitted && process.env.COAST_QA_RECORD === '1';
    if (record) await page.screencast.start({ path: info.outputPath('stair-houses-walk.webm'), size: page.viewportSize()! });
    try {
        await stand(45);
        const height = () => sprite.evaluate(element => element.getBoundingClientRect().height);
        const farHeight = await height();
        if (!fitted) expect(await roofCoverage()).toBeGreaterThan(10);
        await page.screenshot({ path: info.outputPath('behind-noodle-den-roof.png') });
        await stand(80);
        if (!fitted) expect(await roofCoverage()).toBeLessThan(5);
        expect(await height()).toBeGreaterThan(farHeight);
        await page.screenshot({ path: info.outputPath('in-front-of-noodle-den.png') });
        if (!fitted) {
            const hearth = room.locator('.street-layer.hearth');
            await expect(hearth).toHaveCSS('animation-name', 'stair-hearth');
            await page.emulateMedia({ reducedMotion: 'reduce' });
            await expect(hearth).toHaveCSS('animation-name', 'none');
        }
    } finally {
        if (record) await page.screencast.stop();
    }
});

test.describe('working inside coast buildings', () => {
    test.use({ contextOptions: { reducedMotion: 'reduce' } });
    test('a second device finishes the joiner’s work and the first finds its payment', async ({ page, browser, request, context }) => {
        const slip = coastLayout(101)!.sites['saltstair-dock-101'];
        const worker = await actor(request, context, model.fallback(101, slip.approach)!);
        async function enter(p: Page) {
            await openWorld(p);
            await p.getByRole('button', { name: slip.verb + ': ' + slip.name, exact: true }).press('Enter');
            await p.getByRole('button', { name: 'Enter ' + slip.name }).click();
            return p.getByRole('region', { name: 'Fit the ferry plank' });
        }
        const job = await enter(page);
        const other = await browser.newContext({ baseURL: test.info().project.use.baseURL, storageState: await context.storageState(), reducedMotion: 'reduce' });
        const count = async () => {
            const save = await (await request.get('/api/save/' + worker.name, { headers: worker.headers })).json();
            return save.character.itemStacks?.find((row: { itemId: string }) => row.itemId === 'gather-binding-fiber')?.count ?? 0;
        };
        try {
            const before = await count();
            await job.getByRole('button', { name: 'Take the request' }).click();
            await job.getByRole('button', { name: 'Walk to Ferry frame' }).click();
            await expect(job).toContainText('Two thin shims');
            await job.getByRole('button', { name: 'Walk to Joiner’s bench' }).click();
            await job.getByRole('button', { name: 'Add one shim' }).click();
            await expect(job).toContainText('shims fitted · 1');
            const second = await enter(await other.newPage());
            await expect(second).toContainText('Two thin shims');
            await second.getByRole('button', { name: 'Walk to Joiner’s bench' }).click();
            await expect(second).toContainText('shims fitted · 1');
            await second.getByRole('button', { name: 'Add one shim' }).click();
            await second.getByRole('button', { name: 'Test the fit' }).click();
            await expect(second).toContainText('Received · 2 Binding Fiber');
            await expect.poll(count).toBe(before + 2);
            await page.reload();
            const returned = await enter(page);
            await expect(returned).toContainText('1 request finished');
            await expect(returned).toContainText('Received · 2 Binding Fiber');
            expect(await count()).toBe(before + 2);
        } finally { await other.close(); }
    });
    test('the signal tender gives a second order and the quay follows the public pennants', async ({ page, request, context, browser }, info) => {
        const post = coastLayout(118)!.sites['brackwater-counter-118'];
        await actor(request, context, model.fallback(118, post.approach)!, { veteran: true });
        const enter = async () => {
            await openWorld(page);
            await page.getByRole('button', { name: post.verb + ': ' + post.name, exact: true }).press('Enter');
            await page.getByRole('button', { name: 'Enter ' + post.name, exact: true }).click();
        };
        await enter();
        const job = page.getByRole('region', { name: 'Rig the watch signal' });
        await job.getByRole('button', { name: 'Take the request', exact: true }).click();
        await job.getByRole('button', { name: 'Walk to Muster ledger' }).click();
        await expect(job).toContainText('one pennant');
        await page.getByRole('button', { name: 'Climb to the signal loft', exact: true }).last().click();
        await job.getByRole('button', { name: 'Walk to Signal reel' }).click();
        await job.getByRole('button', { name: 'Cross the pennants' }).click();
        await expect(job).toContainText('does not match');
        await job.getByRole('button', { name: 'Hoist one pennant' }).click();
        await expect(job).toContainText('The skiff noses into the channel');
        await page.reload();
        await enter();
        await expect(job).toContainText('1 request finished');
        await job.getByRole('button', { name: 'Take the next request' }).click();
        await job.getByRole('button', { name: 'Walk to Muster ledger' }).click();
        await expect(job).toContainText('timber tow');
        const other = await browser.newContext({ baseURL: info.project.use.baseURL, viewport: info.project.use.viewport, isMobile: info.project.use.isMobile, hasTouch: info.project.use.hasTouch, reducedMotion: 'reduce' });
        try {
            const quay = coastLayout(116)!.sites['brackwater-dock-116'];
            await actor(request, other, model.fallback(116, quay.approach)!, { veteran: true });
            const visitor = await other.newPage();
            await openWorld(visitor);
            const skiff = visitor.locator('.coast-watch-skiff');
            await expect(skiff).toHaveAttribute('data-order', '0');
            await page.getByRole('button', { name: 'Climb to the signal loft', exact: true }).last().click();
            await job.getByRole('button', { name: 'Walk to Signal reel' }).click();
            await job.getByRole('button', { name: 'Cross the pennants' }).click();
            await expect(job).toContainText('waits outside the tow');
            await expect(skiff).toHaveAttribute('data-order', '1', { timeout: 40_000 });
            await expect(skiff.locator('img')).toHaveJSProperty('naturalWidth', 224);
            await skiff.press('Enter');
            await expect(visitor.locator('.coast-world-status')).toContainText('hold the skiff');
            await visitor.screenshot({ path: info.outputPath('quay-under-hold.png') });
        } finally { await other.close(); }
    });
    test('the atlas finds reachable work and a quartermaster checks the fitted kit', async ({ page, request, context }, info) => {
        const fort = coastLayout(107)!.sites['saltstair-fort-107'];
        await actor(request, context, model.fallback(107, fort.approach)!);
        await openWorld(page);
        await page.getByRole('button', { name: 'Coast map', exact: true }).click();
        await page.getByText('Find work and gathering', { exact: true }).click();
        const routes = page.locator('.coast-work-routes');
        await routes.getByRole('combobox').selectOption('Mining');
        await expect(routes).toContainText('Splitstone outcrop');
        await expect(routes).not.toContainText('Silver outcrop');
        await routes.getByRole('combobox').selectOption('Building jobs');
        await expect(routes).toContainText('Outfit the relief watch');
        const entrance = page.getByRole('button', { name: fort.verb + ': ' + fort.name, exact: true });
        let resume!: () => void;
        const delayed = new Promise<void>(resolve => { resume = resolve; });
        await page.route('**/api/player/world-move', async route => {
            if (route.request().method() === 'GET') await delayed;
            await route.continue();
        });
        try {
            await routes.getByRole('button', { name: /^Here/ }).click();
            await expect(page.locator('.continuous-world-map')).toHaveAttribute('aria-busy', 'true');
            await expect(entrance).toHaveCount(0);
        } finally {
            resume();
        }
        await entrance.press('Enter');
        await page.getByRole('button', { name: 'Enter ' + fort.name, exact: true }).click();
        const job = page.getByRole('region', { name: 'Outfit the relief watch' });
        await job.getByRole('button', { name: 'Take the request' }).click();
        await job.getByRole('button', { name: 'Walk to Command table' }).click();
        await job.getByRole('button', { name: 'Walk to Kit rack' }).click();
        await job.getByRole('button', { name: 'Waxed cloth' }).click();
        await job.getByRole('button', { name: 'Wrap the dispatches' }).click();
        await expect(job).toContainText('Waxed cloth · Wrap the dispatches');
        await job.screenshot({ path: info.outputPath('fitted-watch-kit.png') });
        await job.getByRole('button', { name: 'Check the work' }).click();
        await expect(job).toContainText('Received · 1 Torn Hide');
    });
    test('the shared cook house lets a visitor taste and correct a batch', async ({ page, request, context }) => {
        const houses = coastLayout(105)!.sites['saltstair-houses-105'];
        await actor(request, context, model.fallback(105, houses.approach)!);
        await openWorld(page);
        await page.getByRole('button', { name: houses.verb + ': ' + houses.name, exact: true }).press('Enter');
        await page.getByRole('button', { name: 'Cook house', exact: true }).last().click();
        const job = page.getByRole('region', { name: 'Finish the crew’s broth' });
        await job.getByRole('button', { name: 'Take the request' }).click();
        await job.getByRole('button', { name: 'Walk to Soup kettle' }).click();
        await job.getByRole('button', { name: 'Walk to Salt cupboard' }).click();
        await job.getByRole('button', { name: 'Taste the sample' }).click();
        await expect(job).toContainText('Stir in plain stock');
        await job.getByRole('button', { name: 'Add plain stock' }).click();
        await job.getByRole('button', { name: 'Add plain stock' }).click();
        await job.getByRole('button', { name: 'Taste the sample' }).click();
        await expect(job).toContainText('fills the crew’s bowls');
        await expect(job).toContainText('Received · a restorative crew meal and 1 Ration Pack');
    });
    test('the paired watch takes a three-part reply from the ward loft', async ({ page, request, context }) => {
        const post = coastLayout(148)!.sites['hushcrown-fort-148'];
        await actor(request, context, model.fallback(148, post.approach)!, { veteran: true });
        await openWorld(page);
        await page.getByRole('button', { name: post.verb + ': ' + post.name, exact: true }).press('Enter');
        await page.getByRole('button', { name: 'Enter ' + post.name, exact: true }).click();
        const job = page.getByRole('region', { name: 'Answer the paired watch' });
        await job.getByRole('button', { name: 'Take the request' }).click();
        await job.getByRole('button', { name: 'Examine the lower ward disk' }).click();
        await expect(job).toContainText('flash, hold, flash');
        await page.getByRole('button', { name: post.floors[0].stairs[0].label, exact: true }).last().click();
        await job.getByRole('button', { name: 'Read the paired ward case' }).click();
        const send = job.getByRole('button', { name: 'Send signal' });
        await expect(send).toBeDisabled();
        for (const name of ['Flash', 'Flash', 'Flash']) await job.getByRole('button', { name, exact: true }).click();
        await send.click();
        await expect(job).toContainText('second beat');
        await job.getByRole('button', { name: 'Clear signal' }).click();
        for (const name of ['Flash', 'Hold', 'Flash']) await job.getByRole('button', { name, exact: true }).click();
        await send.click();
        await expect(job).toContainText('flash comes back');
    });
});

test.describe('coastal work on arrival', () => {
    test.use({ contextOptions: { reducedMotion: 'reduce' } });
    test('a visitor can watch a patrol, leave, and then choose a fight', async ({ page, request, context }) => {
        const [patrol] = coastPatrolsIn(104, Date.now());
        await actor(request, context, model.fallback(104, patrol.tile)!);
        await openWorld(page);
        const figure = page.getByRole('button', { name: new RegExp('^Inspect .*Level ' + patrol.level + '$') }).first();
        const sheet = page.getByRole('dialog').filter({ has: page.getByRole('button', { name: 'Observe', exact: true }) });
        await figure.press('Enter');
        await sheet.getByRole('button', { name: 'Observe' }).click();
        await expect(sheet.getByRole('status')).toBeVisible();
        await sheet.getByRole('button', { name: 'Leave' }).click();
        await expect(sheet).toHaveCount(0);
        await expect(page.locator('.app-shell')).toHaveAttribute('data-sealed-fight-engaged', 'false');
        await figure.press('Enter');
        const started = page.waitForResponse(response => response.request().method() === 'POST'
            && response.request().postData()?.includes('"kind":"coast-patrol"') === true);
        await sheet.getByRole('button', { name: 'Challenge' }).click();
        expect((await started).ok()).toBe(true);
        await expect(page.locator('.app-shell')).toHaveAttribute('data-sealed-fight-engaged', 'true');
    });
    test('find ordinary fishing at the slip and inspect the required equipment', async ({ page, request, context }) => {
        await actor(request, context, model.fallback(101, COAST_DOCK.tile)!);
        await openWorld(page);
        await page.getByRole('button', { name: 'Slip-side shoal', exact: true }).press('Enter');
        const shoal = page.getByRole('dialog', { name: 'Slip-side shoal' });
        await expect(shoal).toBeVisible({ timeout: 90_000 });
        await expect(shoal.getByText(/Equip a fishing kunai|Ready kunai/i).first()).toBeVisible();
    });
    test('work the spar lashings and return to the same stand with one harvest spent', async ({ page, request, context }) => {
        const stand = resourceNode('coast-resource-pitchwood-lashings')!;
        const position = model.fallback(stand.sector, stand.approach)!;
        await seedWorldActor(request, context, position, model.location(position), {
            questLines: unlockedCoast, triggeredEvents: [...uiAuditSave().triggeredEvents as string[],
                'story-interlude-ashen-leaf-village-88', 'story-interlude-ashen-leaf-village-92'],
            character: { level: 100, equipment: { kama: 'tool-basic-harvest-kama' },
                gatheringToolUses: { 'tool-basic-harvest-kama': 0 } },
        });
        await openWorld(page);
        const marker = page.getByRole('button', { name: stand.name, exact: true });
        await marker.press('Enter');
        const job = page.getByRole('dialog', { name: stand.name });
        await job.getByRole('radio', { name: /Watch animation/ }).check();
        await job.getByRole('button', { name: /Ready kama/ }).click();
        const result = job.getByRole('region', { name: 'Harvesting result' });
        await expect(result).toContainText('49 harvesting attempts left today');
        await result.getByRole('button', { name: 'Back to map' }).click();
        await page.reload();
        await openWorld(page);
        await marker.press('Enter');
        await expect(job).toContainText('49 harvesting attempts left today');
    });
    test('an unequipped visitor mends a net and finds it mended after reloading', async ({ page, request, context }) => {
        await actor(request, context, model.fallback(104, 128)!);
        await openWorld(page);
        await page.getByRole('button', { name: /Net mender · Stretching/ }).press('Enter');
        const job = page.getByRole('dialog', { name: 'Mend the shoal net' });
        await job.getByRole('button', { name: 'Trace the sagging mesh' }).click();
        await job.getByRole('button', { name: 'Walk to the work point' }).click();
        await job.getByRole('button', { name: 'Tighten the headrope' }).click();
        await expect(job.getByRole('status')).toContainText('headrope is already tight');
        await job.getByRole('button', { name: 'Lace the loose bottom loop' }).click();
        await job.getByRole('button', { name: 'Walk to the work point' }).click();
        await job.getByRole('button', { name: 'Help the fisher set the net' }).click();
        await expect(job).toContainText('The knot you tied holds');
        await page.reload();
        await expect(page.getByRole('button', { name: /Net mender · Checking the fisher/ })).toBeVisible();
    });
    test('a completed net rack order reaches the other visitor and a retry counts once', async ({ browser, page, request, context }) => {
        const position = model.fallback(101, 102)!;
        const materials = ['gather-iron-sand','hunt-torn-hide','gather-river-fish','gather-binding-fiber'];
        const worker = await seedWorldActor(request, context, position, model.location(position), {
            questLines: charter, character: { level: 85, itemStacks: materials.map(itemId => ({ itemId, count: 50 })) },
        });
        const peer = await browser.newContext({ baseURL: test.info().project.use.baseURL, reducedMotion: 'reduce' });
        try {
            await actor(request, peer, position);
            const observer = await peer.newPage();
            await Promise.all([openWorld(page), openWorld(observer)]);
            const rack = (p: Page) => p.getByRole('dialog', { name: 'Saltstair net rack' });
            for (const p of [page, observer]) {
                await p.getByRole('button', { name: 'Visit Saltstair net rack' }).press('Enter');
                await rack(p).getByRole('button', { name: 'Repairs', exact: true }).click();
            }
            const before = Number(await rack(observer).getByRole('progressbar').getAttribute('value'));
            await rack(page).getByRole('button', { name: 'Choose repair materials' }).click();
            for (const field of await rack(page).getByRole('spinbutton').all()) await field.fill((await field.getAttribute('max'))!);
            await rack(page).getByRole('button', { name: 'Reserve these materials' }).click();
            for (const label of ['Brace the rack posts','Lace the net to the frame']) await rack(page).getByRole('button', { name: label, exact: true }).click();
            const sent = page.waitForRequest(req => req.url().endsWith('/api/sector/buildings') && req.method() === 'POST' && req.postDataJSON().step === 2);
            await rack(page).getByRole('button', { name: 'Hang the net', exact: true }).click();
            const body = (await sent).postDataJSON();
            await expect(rack(observer).getByRole('progressbar')).toHaveAttribute('value', String(before + 1), { timeout: 45_000 });
            const replay = await request.post('/api/sector/buildings', { headers: worker.headers, data: body });
            expect((await replay.json()).replayed).toBe(true);
        } finally { await peer.close(); }
    });
});
