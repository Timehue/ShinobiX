import { expect, type APIRequestContext, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { test } from './helpers/reconnecting-request';
import { CONTINUOUS_WORLD_SPACE } from '../../shared/continuous-world-layout';
import { uniquePlayerName } from './helpers/player-names';
import { uiAuditSave } from '../e2e/helpers/ui-audit-runtime';
import { LATEST_PATCH_NOTE } from '../src/data/patch-notes';
import { sectorExits } from '../../shared/sector-links';
import { sectorName } from '../../shared/sector-geo';
import { quietRoadCooldowns } from './helpers/quiet-road';

// Run with LIVE_E2E_REALTIME=1. Both browsers use the real Express handlers and
// Socket.IO transport; no presence, save, movement or travel response is mocked.
test.use({ contextOptions: { reducedMotion: 'no-preference' } });

async function account(request: APIRequestContext, side: string) {
    const name = uniquePlayerName(stamp => `walk${side}${stamp}`);
    const registered = await request.post('/api/player-auth', {
        data: { action: 'register', name, password: 'ConnectedJourney!1234' },
    });
    expect(registered.status(), await registered.text()).toBe(200);
    const token = String((await registered.json()).token);
    const headers = { 'x-player-name': name, 'x-player-token': token };
    const save = uiAuditSave();
    save.character = { ...save.character, name, equippedJutsuIds: [], jutsuMastery: [],
        wandererCooldowns: quietRoadCooldowns(Array.from({ length: 65 }, (_, i) => i + 1)) };
    save.worldGeoV = 2;
    save.currentSector = 31; save.currentTile = 85; save.currentBiome = 'snow';
    const seeded = await request.post(`/api/save/${name}?signal=1`, {
        headers: { 'x-admin-password': 'live-express-e2e-admin' }, data: save,
    });
    expect(seeded.status(), await seeded.text()).toBe(200);
    expect((await request.post(`/api/save/${name}?ack=1`, { headers })).status()).toBe(200);
    const canonical = await request.get(`/api/save/${name}`, { headers });
    expect(canonical.status(), await canonical.text()).toBe(200);
    const current = await canonical.json() as Record<string, unknown>;
    expect(current.currentSector).toBe(31);
    return { name, token, headers, canonical: current };
}

async function install(context: BrowserContext, player: Awaited<ReturnType<typeof account>>) {
    await context.addInitScript(({ name, token, canonical, patch }) => {
        localStorage.setItem('ninjav-admin-build-v1', JSON.stringify({ currentAccountName: name }));
        localStorage.setItem('ninjav-player-accounts-v1', JSON.stringify({ [name]: { token } }));
        localStorage.setItem('shinobix:activePlayerPersist', name);
        localStorage.setItem('shinobix:activeTokenPersist', token);
        localStorage.setItem(`ninjav-save-preview-v1:${name.toLowerCase()}`, JSON.stringify(canonical));
        localStorage.setItem('shinobix:storage-notice-ack', '1');
        localStorage.setItem('patchNotes.lastSeenVersion.v1', patch);
        localStorage.setItem('dailyBriefing.seen.v1', new Date().toISOString().slice(0, 10));
        localStorage.setItem('legacyRumors.seen.v1:' + name, JSON.stringify([10, 20, 30, 40, 45]));
    }, { ...player, patch: LATEST_PATCH_NOTE.version });
}

async function openSector(page: Page) {
    await page.goto('/#/worldMap', { waitUntil: 'domcontentloaded' });
    const shell = page.locator('.app-shell[data-screen="worldMap"]');
    const enter = page.getByRole('button', { name: 'Enter World Map', exact: true });
    await expect(shell.or(enter)).toBeVisible({ timeout: 60_000 });
    if (await enter.isVisible()) await enter.click();
    await expect(shell).toBeVisible();
    const back = page.getByRole('button', { name: /Return to Sector 31/ });
    const board = page.locator('.pixel-map[data-ground-floor="true"]');
    await expect(back.or(board)).toBeVisible({ timeout: 60_000 });
    if (await back.isVisible()) await back.click();
    await expect(board).toBeVisible();
    // Tile buttons stay disabled until the world connection is up.
    await expect(board).toHaveAttribute('aria-busy', 'false');
}

// The normal world is the continuous camera (ContinuousWorldSector). Another
// player is a .continuous-world-peer drawn inside the current sector's 12x12
// chunk. The old per-tile .sector-peer overlay now renders only where that
// camera is not mounted: a vault raid, or a sector with no roads.
const peerOf = (page: Page, name: string) => page.locator(`.continuous-world-peer[title^="${name} (Lv "]`);

/** The tile under a peer's feet, read from where it is drawn in the current sector's chunk. */
async function peerTile(peer: Locator) {
    return peer.evaluate(element => {
        const board = element.closest('.continuous-world-chunk')!.getBoundingClientRect();
        const matrix = new DOMMatrix(getComputedStyle(element).transform);
        const node = element as HTMLElement;
        const col = Math.floor((matrix.m41 + node.offsetWidth / 2) / board.width * 12);
        const row = Math.floor((matrix.m42 + node.offsetHeight) / board.height * 12);
        return row * 12 + col;
    });
}

const chunks = new Map(CONTINUOUS_WORLD_SPACE.chunks.map(chunk => [chunk.sector, chunk]));
/** `sector:tile` under this client's own walker, as the camera drew its last frame. */
async function selfTile(page: Page) {
    const at = await page.locator('.continuous-world-map > canvas').evaluate(canvas => ({ ...(canvas as HTMLCanvasElement).dataset }));
    const sector = Number(at.worldSector), chunk = chunks.get(sector)!;
    return `${sector}:${Math.floor(Number(at.worldY) - chunk.y) * 12 + Math.floor(Number(at.worldX) - chunk.x)}`;
}

/**
 * Tile buttons have pointer-events: none. The canvas takes taps, and a tile off
 * the visible map has nothing to tap. Only the current tile is tabbable, so
 * activate the button as assistive tech does: focus it and press Enter.
 */
async function walkTo(page: Page, label: string) {
    await page.getByRole('button', { name: label, exact: true }).press('Enter');
}

/** The sector:tile Express has accepted for a player: the authority behind what both clients draw. */
async function acceptedTile(request: APIRequestContext, player: { headers: Record<string, string> }) {
    const reply = await request.get('/api/player/world-move', { headers: player.headers });
    if (!reply.ok()) return `HTTP ${reply.status()}`;
    const body = await reply.json() as { sector?: number; tile?: number };
    return `${body.sector}:${body.tile}`;
}

/** Where the observer draws a peer's feet, in tiles from the top-left corner of the observer's own sector chunk. */
type Spot = { sector: number; x: number; y: number };
/**
 * Sample, every frame, where the observer draws the named peer. Positions stay
 * fractional, so a peer walking off the painting reads as x >= 12 instead of
 * aliasing onto another tile. `takeSamples` drains what has been taken so far.
 */
async function watchPeer(page: Page, name: string) {
    await page.evaluate(name => {
        const samples: Spot[] = [];
        (window as unknown as { peerWalkReview: Spot[] }).peerWalkReview = samples;
        const sample = () => {
            const element = [...document.querySelectorAll<HTMLElement>('.continuous-world-peer')].find(node => node.title.startsWith(name + ' (Lv '));
            const chunk = element?.closest<HTMLElement>('.continuous-world-chunk');
            const transform = element ? getComputedStyle(element).transform : 'none';
            // A peer mounted this frame has no position yet.
            if (element && chunk && transform !== 'none') {
                const board = chunk.getBoundingClientRect(), matrix = new DOMMatrix(transform);
                samples.push({ sector: Number(chunk.dataset.worldChunk),
                    x: (matrix.m41 + element.offsetWidth / 2) / board.width * 12, y: (matrix.m42 + element.offsetHeight) / board.height * 12 });
            }
            requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
    }, name);
}
const takeSamples = (page: Page) => page.evaluate(() => (window as unknown as { peerWalkReview: Spot[] }).peerWalkReview.splice(0));
const tileOf = (spot: Spot) => spot.x >= 0 && spot.x < 12 && spot.y >= 0 && spot.y < 12
    ? Math.floor(spot.y) * 12 + Math.floor(spot.x) : -1;
/** Distance in tiles from a point to a polyline. */
function distanceToLine(points: readonly { x: number; y: number }[], at: { x: number; y: number }) {
    return Math.min(...points.slice(1).map((b, i) => {
        const a = points[i]!, dx = b.x - a.x, dy = b.y - a.y;
        const t = Math.max(0, Math.min(1, ((at.x - a.x) * dx + (at.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
        return Math.hypot(at.x - a.x - t * dx, at.y - a.y - t * dy);
    }));
}

test('two real clients see grounded walking, sector departure and the same road arrival', async ({ browser, context, page, request, baseURL }, info) => {
    test.setTimeout(180_000);
    expect(process.env.LIVE_E2E_REALTIME).toBe('1');
    const mover = await account(request, 'a'), observer = await account(request, 'b');
    const observerContext = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 },
        isMobile: true, hasTouch: true, reducedMotion: 'no-preference', serviceWorkers: 'block' });
    try {
        await install(context, mover); await install(observerContext, observer);
        const watching = await observerContext.newPage();
        const errors: string[] = [];
        page.on('pageerror', error => errors.push(`mover: ${error.message}`));
        watching.on('pageerror', error => errors.push(`observer: ${error.message}`));
        let moverSocket = false, observerSocket = false;
        // Socket.IO authenticates over polling before upgrading. The WebSocket
        // probe reply or a namespaced event proves the upgraded channel; its
        // original "40" connect packet need not arrive on that channel.
        const livePacket = (payload: string | Buffer) => /^(?:3probe|40|42\[)/.test(String(payload));
        page.on('websocket', socket => socket.on('framereceived', frame => {
            if (livePacket(frame.payload)) moverSocket = true;
        }));
        watching.on('websocket', socket => socket.on('framereceived', frame => {
            if (livePacket(frame.payload)) observerSocket = true;
        }));
        await openSector(page); await openSector(watching);
        await expect.poll(() => moverSocket && observerSocket, { timeout: 30_000 }).toBe(true);
        const peer = peerOf(watching, mover.name);
        await expect(peer).toBeVisible({ timeout: 30_000 });
        await expect.poll(() => peerTile(peer)).toBe(85);
        await watchPeer(watching, mover.name);
        // An independent literal mask checks the actual rendered marker, not
        // the navigator helper that produces its path.
        const mask = ['############','#..........#','#.....TTTT.#','#....TTTTTT#','.......T.T..','============',
            '....=..=....','..BB=.T=BB.#','..BB=..=BB..','...==..===..','....=.......','#...=......#'].join('');
        const grounded = (spot: Spot) => spot.sector === 31 && tileOf(spot) >= 0 && '.='.includes(mask[tileOf(spot)]!);
        await walkTo(page, 'Move near blocked tile row 3 column 7');
        await expect.poll(() => peerTile(peer), { timeout: 30_000 }).toBe(18);
        await expect.poll(() => acceptedTile(request, mover), { timeout: 30_000 }).toBe('31:18');
        const firstWalk = await takeSamples(watching);
        const walked = [...new Set(firstWalk.map(tileOf))];
        expect(walked.length).toBeGreaterThan(4);
        expect(firstWalk.filter(spot => !grounded(spot))).toEqual([]);
        await walkTo(page, 'Move to tile row 6 column 11');
        await expect.poll(() => peerTile(peer), { timeout: 30_000 }).toBe(70);
        await expect.poll(() => acceptedTile(request, mover), { timeout: 30_000 }).toBe('31:70');
        expect((await takeSamples(watching)).filter(spot => !grounded(spot))).toEqual([]);
        const exit = sectorExits(31).find(road => road.destinationSector === 27)!;
        await walkTo(page, `Cross to ${sectorName(27)}`);
        await expect.poll(() => selfTile(page), { timeout: 60_000 }).toBe(`27:${exit.destinationTile}`);
        await expect.poll(() => acceptedTile(request, mover), { timeout: 30_000 }).toBe(`27:${exit.destinationTile}`);
        await expect(page.locator('[data-world-chunk="27"]')).toHaveCount(1);
        // The observer draws the server's nearby players (within 10 tiles) plus
        // live presence in its own sector. The mover now stands in 27, ~35 tiles
        // away, so both sources drop them.
        await expect(peer).toHaveCount(0, { timeout: 30_000 });
        // Before that, the observer watched the mover walk off the painting's
        // east edge along the road, and nothing it drew left the walkable floor
        // or that road. The road is the authored polyline, not the navigator.
        expect(exit.direction).toBe('east');
        const road = CONTINUOUS_WORLD_SPACE.roads.find(line => line.a.id === exit.id || line.b.id === exit.id)!;
        const painting = chunks.get(31)!;
        const onRoad = (spot: Spot) => spot.sector === 31
            && distanceToLine(road.points, { x: painting.x + spot.x, y: painting.y + spot.y }) < .25;
        const departure = await takeSamples(watching);
        expect(departure.some(spot => spot.sector === 31 && spot.x >= 12)).toBe(true);
        expect(departure.filter(spot => !grounded(spot) && !onRoad(spot))).toEqual([]);
        await walkTo(watching, 'Move to tile row 6 column 11');
        await expect.poll(() => selfTile(watching), { timeout: 30_000 }).toBe('31:70');
        await expect.poll(() => acceptedTile(request, observer), { timeout: 30_000 }).toBe('31:70');
        await walkTo(watching, `Cross to ${sectorName(27)}`);
        await expect.poll(() => selfTile(watching), { timeout: 60_000 }).toBe(`27:${exit.destinationTile}`);
        await expect.poll(() => acceptedTile(request, observer), { timeout: 30_000 }).toBe(`27:${exit.destinationTile}`);
        const reunited = peerOf(watching, mover.name);
        await expect(reunited).toBeVisible({ timeout: 30_000 });
        await expect.poll(() => peerTile(reunited)).toBe(exit.destinationTile);
        // Grounded: the current tile is marked only while the walker stands on the painting.
        await expect(watching.locator('.sector-player-tile')).toHaveAttribute('aria-label',
            `Current tile row ${Math.floor(exit.destinationTile / 12) + 1} column ${exit.destinationTile % 12 + 1}`);
        // Neither walk left a "Movement paused" or "Connection interrupted" notice behind.
        for (const client of [page, watching]) await expect(client.locator('.continuous-world-status')).toBeEmpty();
        expect(errors).toEqual([]);
        await page.screenshot({ path: info.outputPath('two-client-mover-1366.png'), fullPage: true });
        await watching.screenshot({ path: info.outputPath('two-client-observer-390.png'), fullPage: true });
        await info.attach('two-client-walking', { body: JSON.stringify({ observedTiles: walked,
            departedEastOnRoad: departure.filter(spot => spot.x >= 12).length, destination: 27,
            arrivalTile: exit.destinationTile, realSocketIo: moverSocket && observerSocket, realExpress: true }), contentType: 'application/json' });
    } finally {
        await observerContext.close();
    }
});
