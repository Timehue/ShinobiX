process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'travel-handler-test-secret-32-bytes-long';

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SECTOR_EXITS } from '../../shared/sector-links.js';

/*
 * /api/player/travel — F11 / N02 / F03, driven through the mounted handler.
 *
 *   F11  the road origin is the SERVER's lease-gated sector, and the server's
 *        last-known tile must be near the exit; a body that claims another
 *        sector is refused.
 *   N02  the durable lease is secured BEFORE live memory moves, so a failed
 *        persistence leaves nothing moved; leases carry a moveId and cleanup
 *        is an exact compare-delete, so an older failure cannot erase a newer
 *        journey.
 *   F03  a settled arrival persists its tile, and a fresh session that reports
 *        none resumes on it.
 */

type Json = Record<string, unknown>;
type Handler = (req: never, res: never) => Promise<unknown>;

let kv: typeof import('../_storage.js').kv;
let onlineStore: typeof import('../_realtime/online-store.js').onlineStore;
let issuePlayerToken: typeof import('../_auth.js').issuePlayerToken;
let lease: typeof import('../_realtime/travel-lease.js');
let travelHandler: Handler;
let heartbeatHandler: Handler;
let tileDistance: typeof import('./travel.js').tileDistance;
let EDGE_ORIGIN_TILE_TOLERANCE: number;
let PET_BREEDING_MIGRATION_VERSION: number;

const PLAYER = 'travelroadtester';
const exit = SECTOR_EXITS[0]!;
let ipSeed = 0;

function response() {
    const out: { statusCode: number; body?: Json } = { statusCode: 200 };
    const res = {
        setHeader: () => res,
        status(code: number) { out.statusCode = code; return res; },
        json(body: Json) { out.body = body; return res; },
        end: () => res,
    };
    return { out, res: res as never };
}

async function post(handler: Handler, body: Json) {
    const token = issuePlayerToken(PLAYER);
    assert.ok(token, 'test session token should be minted');
    const ip = `10.30.0.${++ipSeed}`;
    const { out, res } = response();
    await handler({
        method: 'POST',
        body,
        query: {},
        headers: { 'content-type': 'application/json', 'x-player-name': PLAYER, 'x-player-token': token, 'x-forwarded-for': ip },
        socket: { remoteAddress: ip },
    } as never, res);
    return out;
}

function edgeBody(over: Json = {}): Json {
    return { destinationSector: exit.destinationSector, mode: 'edge', originSector: exit.sector, originTile: exit.tile, exitId: exit.id, ...over };
}

async function place(sector: number, tile: number | undefined) {
    onlineStore.remove(PLAYER);
    await kv.del(lease.travelLeaseKey(PLAYER));
    onlineStore.upsert({ name: PLAYER, sector, character: { level: 20 }, ...(tile === undefined ? {} : { tile }) });
}

function farTile(from: number): number {
    const candidate = (from + 6 * 12) % 144;
    assert.ok(tileDistance(from, candidate) > EDGE_ORIGIN_TILE_TOLERANCE);
    return candidate;
}

before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ onlineStore } = await import('../_realtime/online-store.js'));
    ({ issuePlayerToken } = await import('../_auth.js'));
    lease = await import('../_realtime/travel-lease.js');
    ({ tileDistance, EDGE_ORIGIN_TILE_TOLERANCE } = await import('./travel.js'));
    ({ PET_BREEDING_MIGRATION_VERSION } = await import('../pet/_owned-pet.js'));
    travelHandler = (await import('./travel.js')).default as unknown as Handler;
    heartbeatHandler = (await import('./heartbeat.js')).default as unknown as Handler;
    await kv.set(`save:${PLAYER}`, {
        _saveVersion: 1,
        _saveAt: Date.now(),
        currentSector: exit.sector,
        character: { name: PLAYER, level: 20, hp: 100, maxHp: 100, petBreedingMigrationVersion: PET_BREEDING_MIGRATION_VERSION },
    });
});

after(async () => {
    onlineStore.remove(PLAYER);
    for (const key of await kv.keys('*')) await kv.del(key);
    delete process.env.SHINOBIX_QA_MEMORY_KV;
    delete process.env.SESSION_SECRET;
});

describe('player travel — authoritative origin and durable-first admission', { concurrency: false }, () => {
    it('F11: a road crossing is refused when the body names a sector the server does not hold the player in', async () => {
        const elsewhere = exit.sector === 1 ? 2 : 1;
        await place(elsewhere, exit.tile);
        const out = await post(travelHandler, edgeBody());
        assert.equal(out.statusCode, 409, JSON.stringify(out.body));
        assert.match(String(out.body?.error), /not in that sector/i);
        assert.equal(onlineStore.get(PLAYER)?.sector, elsewhere, 'nothing moved');
        assert.equal(await lease.getTravelLease(PLAYER), null, 'no lease was minted');

        // Omitting the claim does not help: the exit is resolved against the
        // SERVER sector, where this road does not exist.
        const silent = await post(travelHandler, edgeBody({ originSector: undefined }));
        assert.equal(silent.statusCode, 409);
        assert.equal(onlineStore.get(PLAYER)?.sector, elsewhere);
    });

    it('F11: the server\'s last-known tile must be near the exit; an honest player one step behind still crosses', async () => {
        await place(exit.sector, farTile(exit.tile));
        const far = await post(travelHandler, edgeBody());
        assert.equal(far.statusCode, 409, JSON.stringify(far.body));
        assert.match(String(far.body?.error), /road exit/i);
        assert.equal(onlineStore.get(PLAYER)?.sector, exit.sector);

        await place(exit.sector, exit.tile);
        const near = await post(travelHandler, edgeBody());
        assert.equal(near.statusCode, 200, JSON.stringify(near.body));
        assert.equal(near.body?.travelMs, 0, 'an adjacent road crossing stays instant');
        assert.equal(onlineStore.get(PLAYER)?.sector, exit.destinationSector);
        const minted = await lease.getTravelLease(PLAYER);
        assert.ok(minted?.moveId, 'every journey carries its own moveId');
        assert.equal(minted?.arrivalTile, exit.destinationTile, 'the arrival tile comes from the shared topology');
        assert.equal(minted?.originSector, exit.sector);
    });

    it('N02: a failed lease write moves NOTHING — the response and live memory agree', async () => {
        await place(exit.sector, exit.tile);
        const originalSet = kv.set;
        (kv as { set: unknown }).set = async (key: string, value: unknown, opts?: unknown) => {
            if (key.startsWith('world:travel-lease:')) throw new Error('lease-store-down');
            return (originalSet as (k: string, v: unknown, o?: unknown) => Promise<unknown>).call(kv, key, value, opts);
        };
        let out;
        try {
            out = await post(travelHandler, edgeBody());
        } finally {
            (kv as { set: unknown }).set = originalSet;
        }
        assert.equal(out.statusCode, 503, JSON.stringify(out.body));
        const live = onlineStore.get(PLAYER);
        assert.equal(live?.sector, exit.sector, 'the player did NOT move on a failed response');
        assert.equal(live?.travelingUntil, undefined);
        assert.equal(await lease.getTravelLease(PLAYER), null);

        const retry = await post(travelHandler, edgeBody());
        assert.equal(retry.statusCode, 200, JSON.stringify(retry.body));
        assert.equal(onlineStore.get(PLAYER)?.sector, exit.destinationSector, 'the retry moves for real');
    });

    it('N02: an older journey\'s cleanup can never remove a newer journey\'s lease', async () => {
        const now = 5_000_000;
        const older = { originSector: 12, destinationSector: 13, arrivalAt: now + 3_000, arrivalTile: 44, moveId: 'olderjourney0001' };
        const newer = { originSector: 12, destinationSector: 14, arrivalAt: now + 3_000, arrivalTile: 45, moveId: 'newerjourney0002' };
        await kv.del(lease.travelLeaseKey(PLAYER));

        await lease.setTravelLease(PLAYER, newer, now);
        // A different, still-active journey cannot overwrite it ...
        await assert.rejects(() => lease.setTravelLease(PLAYER, older, now), lease.TravelLeaseHeldError);
        // ... and the loser's exact-compare cleanup deletes nothing.
        assert.equal(await lease.clearTravelLeaseIfSame(PLAYER, older), false);
        assert.deepEqual(await lease.getTravelLease(PLAYER), newer, 'the newer lease is intact');
        assert.equal(await lease.clearTravelLeaseIfSame(PLAYER, newer), true, 'only the exact owner clears it');
        assert.equal(await lease.getTravelLease(PLAYER), null);

        // A MATURED lease is not held: its arrival is subsumed by the next origin.
        await lease.setTravelLease(PLAYER, { ...older, arrivalAt: now - 1 }, now);
        await lease.setTravelLease(PLAYER, newer, now);
        assert.deepEqual(await lease.getTravelLease(PLAYER), newer);
        // Leases minted before moveId existed still parse, compare and clear.
        const legacy = { originSector: 12, destinationSector: 13, arrivalAt: now + 3_000 };
        assert.deepEqual(lease.parseTravelLease(legacy), legacy);
    });

    it('F03: a settled arrival persists its tile, and a fresh session resumes on it', async () => {
        const now = Date.now();
        const arrival = { originSector: exit.sector, destinationSector: exit.destinationSector, arrivalAt: now - 10, arrivalTile: exit.destinationTile, moveId: 'settledjourney01' };
        await kv.del(lease.travelLeaseKey(PLAYER));
        await lease.setTravelLease(PLAYER, arrival, now);
        assert.equal(await lease.settleTravelLease(PLAYER, arrival, now), true);
        const record = await kv.get<Json>(`save:${PLAYER}`);
        assert.equal(record?.currentSector, exit.destinationSector);
        assert.equal(record?.currentTile, exit.destinationTile, 'the arrival tile is durable alongside the sector');

        // No live presence, and a beat that reports no tile: the player comes
        // back on the road they arrived by, not on the board's default.
        onlineStore.remove(PLAYER);
        const beat = await post(heartbeatHandler, { name: PLAYER, character: { level: 20 } });
        assert.equal(beat.statusCode, 200, JSON.stringify(beat.body));
        assert.equal(beat.body?.sector, exit.destinationSector);
        assert.equal(onlineStore.get(PLAYER)?.tile, exit.destinationTile);
    });
});
