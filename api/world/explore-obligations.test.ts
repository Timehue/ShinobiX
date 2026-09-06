process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'explore-obligations-test-secret-32-bytes';
delete process.env.DISABLE_VILLAGE_STORES;
delete process.env.DISABLE_INBATTLE_FIELD_GATE;

import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';

/*
 * /api/world/explore driven as a PLAYER (not admin, so every gate applies):
 *
 *   F07  a battle rolled earlier and never fought blocks a fresh roll with
 *        `pending-battle-discovery` naming that exact receipt; once the fight
 *        was started (its marker exists) exploring resumes.
 *   F02  a hospitalized character cannot work the field.
 *   F01  a client asserting `inBattle` cannot work the field either — the
 *        immunity that flag buys is held to its own consequence.
 *   F17  a side effect that fails is parked and delivered on the next
 *        exploration, exactly once.
 */

type Json = Record<string, unknown>;
type Handler = (req: never, res: never) => Promise<unknown>;

let kv: typeof import('../_storage.js').kv;
let onlineStore: typeof import('../_realtime/online-store.js').onlineStore;
let issuePlayerToken: typeof import('../_auth.js').issuePlayerToken;
let handler: Handler;
let exploreBattleMarkerKey: typeof import('../missions/_generic-ai-fight-authority.js').exploreBattleMarkerKey;
let worldEffectsOutboxKey: typeof import('./_effects-outbox.js').worldEffectsOutboxKey;
let parseWorldEffects: typeof import('./_effects-outbox.js').parseWorldEffects;
let villageIntelKey: (village: string) => string;
let PET_BREEDING_MIGRATION_VERSION: number;

const PLAYER = 'obligationsplayer';
const SECTOR = 12;
let ipSeed = 0;
let ids = 0;
const nextId = () => `obligation-req-${String(++ids).padStart(6, '0')}`;

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

async function explore(requestId = nextId()) {
    const token = issuePlayerToken(PLAYER);
    const ip = `10.70.0.${++ipSeed}`;
    const { out, res } = response();
    await handler({
        method: 'POST',
        body: { playerName: PLAYER, requestId, sector: SECTOR },
        query: {},
        headers: { 'content-type': 'application/json', 'x-player-name': PLAYER, 'x-player-token': token, 'x-forwarded-for': ip },
        socket: { remoteAddress: ip },
    } as never, res);
    // A rolled battle is an obligation; claim its marker as a started fight
    // would, so a test that explores twice is not refused by its own first roll.
    if ((out.body?.outcome as Json | undefined)?.kind === 'battle') {
        await kv.set(exploreBattleMarkerKey(PLAYER, requestId), { playerName: PLAYER, token: 'fixture', sessionId: 'fixture', at: Date.now() });
    }
    return { ...out, requestId };
}

async function seed(character: Json = {}) {
    await kv.set(`save:${PLAYER}`, {
        _saveVersion: 1,
        _saveAt: Date.now(),
        currentSector: SECTOR,
        character: {
            name: PLAYER, level: 12, village: 'Mist', hp: 100, maxHp: 100, chakra: 50, maxChakra: 50, stamina: 50, maxStamina: 50,
            ryo: 0, petBreedingMigrationVersion: PET_BREEDING_MIGRATION_VERSION, stats: {}, inventory: [], itemStacks: [],
            ...character,
        },
    });
}

function present(inBattle = false) {
    onlineStore.remove(PLAYER);
    onlineStore.upsert({ name: PLAYER, sector: SECTOR, character: { level: 12 }, tile: 5, ...(inBattle ? { inBattle: true } : {}) });
}

before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ onlineStore } = await import('../_realtime/online-store.js'));
    ({ issuePlayerToken } = await import('../_auth.js'));
    ({ exploreBattleMarkerKey } = await import('../missions/_generic-ai-fight-authority.js'));
    ({ worldEffectsOutboxKey, parseWorldEffects } = await import('./_effects-outbox.js'));
    ({ villageIntelKey } = await import('../_village-intel.js') as unknown as { villageIntelKey: (village: string) => string });
    ({ PET_BREEDING_MIGRATION_VERSION } = await import('../pet/_owned-pet.js'));
    handler = (await import('./explore.js')).default as unknown as Handler;
});

beforeEach(async () => {
    for (const key of await kv.keys('*')) await kv.del(key);
    await seed();
    present();
});

after(async () => {
    onlineStore.remove(PLAYER);
    for (const key of await kv.keys('*')) await kv.del(key);
    delete process.env.SHINOBIX_QA_MEMORY_KV;
    delete process.env.SESSION_SECRET;
});

describe('world/explore — obligations and admissions', { concurrency: false }, () => {
    it('F07: an unstarted ambush blocks a fresh roll and is named; a started one does not', async () => {
        const ambushId = 'ambush-receipt-00001';
        const save = await kv.get<Json>(`save:${PLAYER}`);
        await kv.set(`save:${PLAYER}`, {
            ...save,
            character: {
                ...(save?.character as Json),
                redeemedSectorExplorations: [{ id: ambushId, sector: SECTOR, reward: { sector: SECTOR, xp: 1, ryo: 0 }, outcome: { kind: 'battle' }, at: Date.now() - 5_000 }],
            },
        });

        const refused = await explore();
        assert.equal(refused.statusCode, 409, JSON.stringify(refused.body));
        assert.equal(refused.body?.error, 'pending-battle-discovery');
        assert.equal(refused.body?.requestId, ambushId, 'the exact owed encounter is named');
        assert.equal(refused.body?.sector, SECTOR);
        const untouched = (await kv.get<Json>(`save:${PLAYER}`))?.character as Json;
        assert.equal(untouched.serverExploresToday, undefined, 'the refused roll counted nothing');

        // The fight was started (marker claimed by ai-fight-start): exploring resumes.
        await kv.set(exploreBattleMarkerKey(PLAYER, ambushId), { playerName: PLAYER, token: 't', sessionId: 's', at: Date.now() });
        const allowed = await explore();
        assert.equal(allowed.statusCode, 200, JSON.stringify(allowed.body));
    });

    it('F07: an exact replay of the ambush receipt itself is still answered', async () => {
        const ambushId = 'ambush-receipt-00002';
        const save = await kv.get<Json>(`save:${PLAYER}`);
        await kv.set(`save:${PLAYER}`, {
            ...save,
            character: {
                ...(save?.character as Json),
                redeemedSectorExplorations: [{ id: ambushId, sector: SECTOR, reward: { sector: SECTOR, xp: 1, ryo: 0 }, outcome: { kind: 'battle' }, at: Date.now() - 5_000 }],
            },
        });
        const replay = await explore(ambushId);
        assert.equal(replay.statusCode, 200, JSON.stringify(replay.body));
        assert.equal(replay.body?.replayed, true);
        assert.equal((replay.body?.outcome as Json)?.kind, 'battle');
    });

    it('F02: a hospitalized character cannot work the field', async () => {
        await seed({ hospitalized: true, hp: 0, hospitalizedUntil: Date.now() + 60_000 });
        const out = await explore();
        assert.equal(out.statusCode, 409, JSON.stringify(out.body));
        assert.equal(out.body?.reason, 'hospitalized');
    });

    it('F01: a client asserting inBattle cannot work the field; the same client without the claim can', async () => {
        present(true);
        const refused = await explore();
        assert.equal(refused.statusCode, 409, JSON.stringify(refused.body));
        assert.equal(refused.body?.reason, 'battle-active');
        present(false);
        const allowed = await explore();
        assert.equal(allowed.statusCode, 200, JSON.stringify(allowed.body));
    });

    it('F17: a failed side effect is parked and delivered by the next exploration, once', async () => {
        const originalSet = kv.set;
        (kv as { set: unknown }).set = async (key: string, value: unknown, opts?: unknown) => {
            if (key === villageIntelKey('Mist')) throw new Error('intel-store-down');
            return (originalSet as (k: string, v: unknown, o?: unknown) => Promise<unknown>).call(kv, key, value, opts);
        };
        let first;
        try {
            first = await explore();
        } finally {
            (kv as { set: unknown }).set = originalSet;
        }
        assert.equal(first.statusCode, 200, JSON.stringify(first.body));
        const parked = parseWorldEffects(await kv.get(worldEffectsOutboxKey(PLAYER)));
        assert.equal(parked.length, 1, 'the failed intel credit is parked, the successful contract tick is not');
        assert.equal(parked[0].kind, 'intel');
        assert.equal(parked[0].requestId, first.requestId);
        assert.equal(await kv.get(villageIntelKey('Mist')), null, 'nothing was credited while the store was down');

        const second = await explore();
        assert.equal(second.statusCode, 200, JSON.stringify(second.body));
        assert.deepEqual(parseWorldEffects(await kv.get(worldEffectsOutboxKey(PLAYER))), [], 'drained');
        const intel = await kv.get<{ sectors?: Record<string, { points: number }> }>(villageIntelKey('Mist'));
        assert.ok(intel?.sectors?.[String(SECTOR)], 'the parked credit landed');
    });
});
