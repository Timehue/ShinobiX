process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'hospital-ward-test-secret-with-enough-entropy';

import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';

/*
 * "If you are knocked out you show up in the hospital, for other players to heal."
 *
 * The ward list used to come from the public roster, and could not show it:
 * an ONLINE patient's roster row is built from their presence frame, which does
 * not carry `hospitalized`, so everyone knocked out while playing was invisible
 * for their whole 60-second stay. The roster is also cached for up to ~90 s.
 *
 * GET /api/player/hospital-ward reads the saves — the authority on admission —
 * for the caller's own village, uncached. The roster now also grafts the save's
 * admission onto an online patient's row, so every roster reader agrees.
 */

type Json = Record<string, any>;
type Handler = (req: never, res: never) => Promise<unknown>;
const VILLAGE = 'Stormveil Village';
const NOW = Date.now();

let kv: typeof import('../_storage.js').kv;
let onlineStore: typeof import('../_realtime/online-store.js').onlineStore;
let issuePlayerToken: typeof import('../_auth.js').issuePlayerToken;
let ward: Handler;
let roster: Handler;
let injuredVillagers: Handler;
let clearProcCache: () => void;
let ipSeed = 0;

type Seed = { slug: string; village?: string; hp?: number; admittedAt?: number; extra?: Json };

async function seedPlayers(players: Seed[]) {
    const { buildPublicPlayerIndexEntry } = await import('./_public-index.js');
    const registry: Json = {};
    for (const p of players) {
        const village = p.village ?? VILLAGE;
        const character: Json = {
            name: p.slug, village, level: 20, hp: p.hp ?? 500, maxHp: 500,
            ...(p.admittedAt !== undefined ? { hp: 0, hospitalized: true, hospitalizedAt: p.admittedAt, hospitalizedUntil: p.admittedAt + 60_000 } : {}),
            ...p.extra,
        };
        await kv.set(`save:${p.slug}`, { _saveVersion: 1, _saveAt: NOW, worldGeoV: 2, currentSector: 0, character });
        registry[p.slug] = buildPublicPlayerIndexEntry(character, p.slug, NOW);
    }
    await kv.hset('player:registry', registry);
}

async function get(handler: Handler, as: string, query: Json) {
    const out: { status: number; body: Json; headers: Record<string, string> } = { status: 200, body: {}, headers: {} };
    const res = {
        setHeader(key: string, value: string) { out.headers[key.toLowerCase()] = value; return res; },
        status(code: number) { out.status = code; return res; },
        json(value: Json) { out.body = value; return res; },
        end() { return res; },
    };
    const ip = `10.93.0.${++ipSeed}`;
    await handler({
        method: 'GET', query,
        headers: as ? { 'x-player-name': as, 'x-player-token': issuePlayerToken(as)!, 'x-forwarded-for': ip } : { 'x-forwarded-for': ip },
        socket: { remoteAddress: ip },
    } as never, res as never);
    return out;
}

before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ onlineStore } = await import('../_realtime/online-store.js'));
    ({ issuePlayerToken } = await import('../_auth.js'));
    ({ __clearProcCache: clearProcCache } = await import('../_proc-cache.js'));
    ward = (await import('./hospital-ward.js')).default as unknown as Handler;
    roster = (await import('./roster.js')).default as unknown as Handler;
    injuredVillagers = (await import('./injured-villagers.js')).default as unknown as Handler;
});

beforeEach(async () => {
    for (const key of await kv.keys('*')) await kv.del(key);
    for (const player of onlineStore.list()) onlineStore.remove(player.name);
    clearProcCache();
});

after(async () => {
    for (const key of await kv.keys('*')) await kv.del(key);
    for (const player of onlineStore.list()) onlineStore.remove(player.name);
});

describe('GET /api/player/hospital-ward', { concurrency: false }, () => {
    it("lists the caller's own village's admitted players, online or offline, longest-waiting first", async () => {
        await seedPlayers([
            { slug: 'visitor' },
            { slug: 'fresh', admittedAt: NOW - 5_000 },
            { slug: 'waiting', admittedAt: NOW - 50_000 },
            { slug: 'overdue', admittedAt: NOW - 600_000 }, // offline past the timer: still in the bed
            { slug: 'hurtbutup', hp: 40 },                   // injured, not admitted
            { slug: 'rival', village: 'Frostfang Village', admittedAt: NOW - 1_000 },
        ]);
        // Online patients carry no admission in their presence frame; the ward
        // must not depend on it.
        onlineStore.upsert({ name: 'fresh', sector: 12, character: { level: 20, hp: 500, maxHp: 500 } });

        const out = await get(ward, 'visitor', { playerName: 'visitor' });
        assert.equal(out.status, 200, JSON.stringify(out.body));
        assert.equal(out.body.village, VILLAGE);
        assert.deepEqual(out.body.patients.map((p: Json) => p.name), ['overdue', 'waiting', 'fresh']);
        const fresh = out.body.patients.find((p: Json) => p.name === 'fresh');
        assert.equal(fresh.hp, 0, "the save's HP, not the stale presence frame's");
        assert.equal(fresh.freeCheckoutAt, fresh.admittedAt + 60_000);
        assert.equal(out.headers['cache-control'], 'private, no-cache');
    });

    it('is open to every villager, not only Healers (only Healers get a Heal button)', async () => {
        await seedPlayers([{ slug: 'plainninja' }, { slug: 'patient', admittedAt: NOW - 1_000 }]);
        const out = await get(ward, 'plainninja', { playerName: 'plainninja' });
        assert.equal(out.status, 200);
        assert.deepEqual(out.body.patients.map((p: Json) => p.name), ['patient']);
    });

    it('never lists the caller themself', async () => {
        await seedPlayers([{ slug: 'selfpatient', admittedAt: NOW - 1_000 }]);
        const out = await get(ward, 'selfpatient', { playerName: 'selfpatient' });
        assert.equal(out.status, 200);
        assert.deepEqual(out.body.patients, []);
    });

    it('requires the caller to be the named player', async () => {
        await seedPlayers([{ slug: 'alpha' }, { slug: 'beta' }]);
        assert.equal((await get(ward, '', { playerName: 'alpha' })).status, 401);
        assert.equal((await get(ward, 'beta', { playerName: 'alpha' })).status, 403, "no reading another village's ward by name");
    });
});

describe('GET /api/player/roster grafts the admission onto an online patient', { concurrency: false }, () => {
    it('shows an online patient as admitted, with the save\'s HP', async () => {
        await seedPlayers([{ slug: 'onlinepatient', admittedAt: NOW - 2_000 }, { slug: 'onlinehealthy' }]);
        onlineStore.upsert({ name: 'onlinepatient', sector: 9, character: { name: 'onlinepatient', level: 20, village: VILLAGE, hp: 500, maxHp: 500 } });
        onlineStore.upsert({ name: 'onlinehealthy', sector: 9, character: { name: 'onlinehealthy', level: 20, village: VILLAGE, hp: 500, maxHp: 500 } });

        const out = await get(roster, '', {});
        assert.equal(out.status, 200, JSON.stringify(out.body));
        const rows = new Map((out.body.players as Json[]).map((p) => [p.name, p]));
        const patient = rows.get('onlinepatient');
        assert.equal(patient?.online, true);
        assert.equal(patient?.character.hospitalized, true, 'presence alone would have said nothing');
        assert.equal(patient?.character.hp, 0);
        assert.equal(rows.get('onlinehealthy')?.character.hospitalized, undefined, 'a healthy player is untouched');
    });
});

describe('Village Lifeline reaches the world-wide injured list below Rank 10', { concurrency: false }, () => {
    it('a capstone holder may list injured villagers; a plain Rank-1 Healer may not', async () => {
        await seedPlayers([
            { slug: 'lifeliner', extra: { profession: 'healer', professionXp: 0, masterySpec: { 'village-lifeline': 1 } } },
            { slug: 'novicehealer', extra: { profession: 'healer', professionXp: 0 } },
            { slug: 'woundedally', hp: 120 },
        ]);
        const allowed = await get(injuredVillagers, 'lifeliner', { healerName: 'lifeliner' });
        assert.equal(allowed.status, 200, JSON.stringify(allowed.body));
        assert.deepEqual(allowed.body.injured.map((p: Json) => p.name), ['woundedally']);
        const refused = await get(injuredVillagers, 'novicehealer', { healerName: 'novicehealer' });
        assert.equal(refused.status, 403);
    });
});
