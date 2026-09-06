process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.ADMIN_PASSWORD = 'heartbeat-town-escape-admin';

import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';

/*
 * F10 — opening a town panel never moves an ENGAGED character.
 *
 * Presence accepts a claim of sector 0 unconditionally (town entry is client
 * navigation, and that convenience is kept). A player who has just been
 * attacked in the wild, or who is mid-raid, could use it to vanish before the
 * fight reached them. The safe-zone exit is now refused while a world duel is
 * engaging the player; a finished duel, a spar, or nothing at all still lets
 * them go home instantly.
 */

type Json = Record<string, unknown>;
type Handler = (req: never, res: never) => Promise<unknown>;

let kv: typeof import('../_storage.js').kv;
let onlineStore: typeof import('../_realtime/online-store.js').onlineStore;
let handler: Handler;
let pvpPendingSessionKey: typeof import('../pvp/_pending-session.js').pvpPendingSessionKey;
let engagedInWorldDuel: typeof import('../_realtime/world-duel-engagement.js').engagedInWorldDuel;

const PLAYER = 'townescapeplayer';
const WILD = 12;
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

async function beat(sector: number) {
    const ip = `10.80.0.${++ipSeed}`;
    const { out, res } = response();
    await handler({
        method: 'POST',
        body: { name: PLAYER, sector, character: { level: 20 }, tile: 5 },
        query: {},
        headers: { 'content-type': 'application/json', 'x-admin-password': process.env.ADMIN_PASSWORD, 'x-forwarded-for': ip },
        socket: { remoteAddress: ip },
    } as never, res);
    return out;
}

function pointer(battleId: string, phase: 'active' | 'reserving' = 'active'): string {
    return JSON.stringify({
        version: 1, playerName: PLAYER, battleId, role: 'p1', createdAt: Date.now() - 1_000, phase,
        ...(phase === 'reserving' ? { reservedUntil: Date.now() + 30_000 } : {}),
    });
}

function session(status: 'active' | 'done', over: Json = {}): Json {
    return { battleId: 'duel-1', status, winner: status === 'done' ? 'p2' : null, continuousVitals: true, rewardAuthority: 'world', p1: { name: PLAYER, hp: 50 }, p2: { name: 'raider', hp: 50 }, ...over };
}

before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ onlineStore } = await import('../_realtime/online-store.js'));
    ({ pvpPendingSessionKey } = await import('../pvp/_pending-session.js'));
    ({ engagedInWorldDuel } = await import('../_realtime/world-duel-engagement.js'));
    handler = (await import('./heartbeat.js')).default as unknown as Handler;
});

beforeEach(async () => {
    for (const key of await kv.keys('*')) await kv.del(key);
    onlineStore.remove(PLAYER);
    onlineStore.upsert({ name: PLAYER, sector: WILD, character: { level: 20 }, tile: 5 });
});

after(async () => {
    onlineStore.remove(PLAYER);
    for (const key of await kv.keys('*')) await kv.del(key);
    delete process.env.SHINOBIX_QA_MEMORY_KV;
    delete process.env.ADMIN_PASSWORD;
});

describe('heartbeat — an engaged player cannot walk into town', { concurrency: false }, () => {
    it('an unengaged player still enters town instantly', async () => {
        const out = await beat(0);
        assert.equal(out.statusCode, 200, JSON.stringify(out.body));
        assert.equal(out.body?.sector, 0);
        assert.equal(onlineStore.get(PLAYER)?.sector, 0);
    });

    it('the beat that delivers a queued attacker keeps the target in the wild', async () => {
        onlineStore.setPendingAttacker(PLAYER, { name: 'raider' });
        const out = await beat(0);
        assert.equal(out.statusCode, 200, JSON.stringify(out.body));
        assert.ok(out.body?.pendingAttacker, 'the attack is delivered');
        assert.equal(out.body?.sector, WILD, 'and the target did not vanish into town');
        assert.equal(onlineStore.get(PLAYER)?.sector, WILD);
    });

    it('an active vitals-carrying PvP session holds the player; a finished one or a spar does not', async () => {
        await kv.set(pvpPendingSessionKey(PLAYER), pointer('duel-1'));
        await kv.set('pvp:duel-1', session('active'));
        assert.equal((await beat(0)).body?.sector, WILD, 'mid-raid: no town');
        assert.equal(onlineStore.get(PLAYER)?.sector, WILD);

        await kv.set('pvp:duel-1', session('done'));
        assert.equal((await beat(0)).body?.sector, 0, 'a finished duel is not engagement');

        onlineStore.remove(PLAYER);
        onlineStore.upsert({ name: PLAYER, sector: WILD, character: { level: 20 }, tile: 5 });
        await kv.set('pvp:duel-1', session('active', { continuousVitals: false, rewardAuthority: 'challenge' }));
        assert.equal((await beat(0)).body?.sector, 0, 'a spar resets both fighters and cannot be escaped into town in any way that matters');
    });

    it('engagement evidence is server-written only', async () => {
        const store = kv;
        assert.equal(await engagedInWorldDuel(store, PLAYER, { pendingAttacker: null }), false);
        assert.equal(await engagedInWorldDuel(store, PLAYER, { pendingAttacker: { name: 'raider' } }), true);
        await kv.set(pvpPendingSessionKey(PLAYER), pointer('duel-2', 'reserving'));
        assert.equal(await engagedInWorldDuel(store, PLAYER, { pendingAttacker: null }), true, 'a fresh reservation is a duel being created');
        await kv.set(pvpPendingSessionKey(PLAYER), 'not-json');
        assert.equal(await engagedInWorldDuel(store, PLAYER, { pendingAttacker: null }), false, 'a malformed pointer is not evidence');
    });
});
