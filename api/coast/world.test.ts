import assert from 'node:assert/strict';
import { before, test } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'coast-world-test-secret';

import { COAST_WORLD, OPEN_COAST_SECTOR_IDS } from '../../shared/coast-world.js';
import { roomDuties, type RoomDuty } from '../../shared/coast-room-duties.js';
import type { CoastSite } from '../../shared/coast-world-rules.js';
import { coastTileWalkable } from '../../shared/coast-world-rules.js';

/*
 * /api/coast/world: the coast's map as the client draws it. The client keeps no
 * copy, so this reply is the whole of what a player can be shown.
 */

type Json = Record<string, unknown>;
type Handler = (req: never, res: never) => Promise<unknown>;
let handler: Handler;
let token: typeof import('../_auth.js').issuePlayerToken;

before(async () => {
    ({ issuePlayerToken: token } = await import('../_auth.js'));
    handler = (await import('./world.js')).default as unknown as Handler;
});

async function call(method: string, name?: string, query: Record<string, string> = {}) {
    const out = { status: 200, body: {} as Json, headers: {} as Record<string, string> };
    const res = {
        setHeader(key: string, value: string) { out.headers[key.toLowerCase()] = value; return res; },
        status(value: number) { out.status = value; return res; },
        json(value: Json) { out.body = value; return res; },
        end() { return res; },
    };
    await handler({ method, query, headers: name ? { 'x-player-token': token(name) } : {}, socket: { remoteAddress: '127.4.9.3' } } as never, res as never);
    return out;
}

test('it is read with GET by a signed-in player, and by nobody else', async () => {
    assert.equal((await call('GET')).status, 401);
    assert.equal((await call('POST', 'coastreader')).status, 405);
    const reply = await call('GET', 'coastreader');
    assert.equal(reply.status, 200);
    assert.match(reply.headers['cache-control'], /^private/);
});

test('every open sector is drawn with its floor, its trails and its places', async () => {
    const body = (await call('GET', 'coastreader')).body as {
        atlas: { width: number; height: number; image: string };
        points: { sector: number }[]; regions: string[];
        sectors: Record<string, { name: string; mask: string[]; floor: string; exits: { tile: number; destinationSector: number }[]; sites: { id: string; approach: number; boat?: boolean; gather?: string }[] }>;
    };
    assert.equal(body.points.length, 50);
    assert.equal(body.regions.length, 5);
    assert.ok(body.atlas.width > 0 && body.atlas.image.endsWith('.webp'));
    assert.deepEqual(Object.keys(body.sectors).map(Number).sort((a, b) => a - b), [...OPEN_COAST_SECTOR_IDS].sort((a, b) => a - b));
    for (const [id, sector] of Object.entries(body.sectors)) {
        assert.equal(sector.floor, id === '105' ? 'saltstair-landing/floors/s105-v2.webp' : `s${id}.webp`);
        assert.equal(sector.mask.length, 12);
        assert.ok(sector.exits.length > 0, `sector ${id} has no trail`);
        for (const exit of sector.exits) assert.equal(coastTileWalkable(sector.mask, exit.tile), true, `sector ${id}: a trail leaves from ground that cannot be stood on`);
        for (const site of sector.sites) assert.equal(coastTileWalkable(sector.mask, site.approach), true, `${site.id}: its entrance cannot be stood on`);
    }
    // The slip is where the boat home is boarded; quest sites say how they are worked.
    assert.equal(body.sectors['101'].sites.find(site => site.id === 'saltstair-dock-101')?.boat, true);
    assert.equal(body.sectors['102'].sites.find(site => site.id === 'saltstair-harvest-102')?.gather, 'harvesting');
    assert.equal(body.sectors['103'].sites.find(site => site.id === 'saltstair-mine-103')?.gather, 'mining');
    assert.equal(body.sectors['107'].sites.some(site => site.boat || site.gather), false);
});

test('visitors see the current watch independently of the cached atlas', async () => {
    const { kv } = await import('../_storage.js');
    const { COAST_WATCHES } = await import('../../shared/coast-watch.js');
    for (const watch of Object.keys(COAST_WATCHES)) {
        await kv.set('world:coast-watch:' + watch, { order: 2 });
        const observation = await call('GET', 'coastreader', { watch });
        assert.equal(observation.status, 200);
        assert.equal(observation.headers['cache-control'], 'no-store');
        assert.deepEqual(observation.body, { order: 2 });
        await kv.set('world:coast-watch:' + watch, { order: 30 });
        assert.deepEqual((await call('GET', 'coastreader', { watch })).body, { order: null });
    }
    assert.equal((await call('GET', 'coastreader', { watch: 'unknown' })).status, 400);
});

test('each building sends its complete walkable rooms and outdoor return', async () => {
    const { sectors } = (await call('GET', 'coastreader')).body as { sectors: Record<string, { sites: (CoastSite & { workshop?: RoomDuty })[] }> };
    for (const [sector, layout] of Object.entries(COAST_WORLD.layouts)) {
        for (const source of Object.values(layout.sites)) {
            const site = sectors[sector].sites.find(entry => entry.id === source.id);
            assert.ok(site, source.id);
            assert.equal(site.returnTile, source.returnTile);
            assert.deepEqual(site.floors ?? [], source.floors, source.id);
            assert.deepEqual(site.workshop, roomDuties[source.id], source.id);
        }
    }
});
