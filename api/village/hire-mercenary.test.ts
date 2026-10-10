process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'hire-mercenary-retired-test-secret-32b';

import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';

/*
 * The Town Hall Honor-Seal mercenary hire is RETIRED (owner ruling 2026-10-08):
 * village-war mercenaries are hired as AI bands from the War Map now. The route
 * must refuse every NEW hire, yet still finish a hire already in flight — no war
 * row may stay frozen, nothing already paid may be lost, nothing charged twice.
 */

type Json = Record<string, unknown>;
type Handler = (req: never, res: never) => Promise<unknown>;
type KvLike = import('../_storage.js').KvLike;
type Identity = import('../_war-mercenary-hire.js').WarMercenaryHireIdentity;

const WAR_ID = 'leafvillage-vs-mistvillage';
const WAR_KEY = `world:war:${WAR_ID}`;
const LEAF = 'Leaf Village';
const MIST = 'Mist Village';
const HIRER = 'sealhirer';
const NEIGHBOUR = 'leafneighbour';
const TIER = 'merc-ronin'; // 150 seals, 120 war damage

let kv: typeof import('../_storage.js').kv;
let issuePlayerToken: typeof import('../_auth.js').issuePlayerToken;
let resetRateLimits: typeof import('../_ratelimit.js').__resetRateLimitsForTest;
let saga: typeof import('../_war-mercenary-hire.js');
let handler: Handler;
let retiredMessage: string;
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

async function hire(player: string, tierId = TIER) {
    const ip = `10.71.0.${++ipSeed}`;
    const { out, res } = response();
    await handler({
        method: 'POST',
        body: { action: 'hire', tierId },
        query: {},
        headers: { 'content-type': 'application/json', 'x-player-name': player, 'x-player-token': issuePlayerToken(player)!, 'x-forwarded-for': ip },
        socket: { remoteAddress: ip },
    } as never, res);
    return out;
}

function warRow(now: number): Json {
    return {
        id: WAR_ID,
        villages: [LEAF, MIST],
        hp: { [LEAF]: 5_000, [MIST]: 5_000 },
        warGroundSector: 40,
        warGroundHp: 1_000,
        startedAt: now - 2 * 3_600_000,
        pendingUntil: now - 3_600_000,
        updatedAt: now - 3_600_000,
        lastDecayDate: new Date(now).toISOString().slice(0, 10),
        declarationGeneration: 2,
        contributions: {},
    };
}

function identity(war: Json): Identity {
    return {
        hireId: `merc:${WAR_ID}-g2:${HIRER}:${TIER}`,
        warId: WAR_ID,
        warToken: `${WAR_ID}-g2`,
        generation: 2,
        warEndsAt: Number(war.pendingUntil) + 14 * 24 * 3_600_000,
        player: HIRER,
        displayName: 'SealHirer',
        village: LEAF,
        enemy: MIST,
        tierId: TIER,
        costSeals: 150,
        warDamage: 120,
        sourceKey: `save:${HIRER}`,
    };
}

/** Run the OLD hire saga, crashing at `crashAt`, to leave it in flight exactly
 *  as a request that died before this release would have. */
async function strandHire(now: number, crashAt: 'before-debit' | 'before-activation') {
    const expectedWar = (await kv.get<Json>(WAR_KEY))!;
    let crashed = false;
    const crashing: Pick<KvLike, 'get' | 'set' | 'compareSet'> = {
        get: kv.get.bind(kv),
        set: kv.set.bind(kv),
        compareSet: async (key, expected, value, options) => {
            const debit = key === `save:${HIRER}`;
            const activation = key === WAR_KEY
                && !!(expected as Json)?.[saga.WAR_MERCENARY_FUNDING_FIELD]
                && !(value as Json)?.[saga.WAR_MERCENARY_FUNDING_FIELD];
            if (!crashed && ((crashAt === 'before-debit' && debit) || (crashAt === 'before-activation' && activation))) {
                crashed = true;
                throw new Error(`crash-${crashAt}`);
            }
            return kv.compareSet(key, expected, value, options);
        },
    };
    const plan = identity(expectedWar);
    await assert.rejects(saga.settleWarMercenaryHire(crashing, {
        ...plan,
        warKey: WAR_KEY,
        fingerprint: saga.warMercenaryHireFingerprint(plan),
        ownerId: 'pre-retirement-owner',
        now,
        expectedWar,
    }), new RegExp(`crash-${crashAt}`));
    assert.ok((await kv.get<Json>(WAR_KEY))?.[saga.WAR_MERCENARY_FUNDING_FIELD], 'the war row is frozen');
}

async function seals(player: string): Promise<number> {
    return Number(((await kv.get<Json>(`save:${player}`))?.character as Json)?.honorSeals);
}

async function warHp(): Promise<number> {
    return Number(((await kv.get<Json>(WAR_KEY))?.hp as Json)?.[MIST]);
}

before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ issuePlayerToken } = await import('../_auth.js'));
    ({ __resetRateLimitsForTest: resetRateLimits } = await import('../_ratelimit.js'));
    saga = await import('../_war-mercenary-hire.js');
    const loaded = await import('./hire-mercenary.js');
    handler = ((loaded.default as unknown as { default?: Handler })?.default ?? loaded.default) as unknown as Handler;
    retiredMessage = loaded.MERCENARY_HIRE_RETIRED_MESSAGE;
});

beforeEach(async () => {
    for (const key of await kv.keys('*')) await kv.del(key);
    resetRateLimits();
    const now = Date.now();
    await kv.set(WAR_KEY, warRow(now));
    await kv.set(`save:${HIRER}`, { _saveVersion: 1, character: { name: 'SealHirer', village: LEAF, honorSeals: 800 } });
    await kv.set(`save:${NEIGHBOUR}`, { _saveVersion: 1, character: { name: 'LeafNeighbour', village: LEAF, honorSeals: 900 } });
});

after(async () => {
    for (const key of await kv.keys('*')) await kv.del(key);
    delete process.env.SHINOBIX_QA_MEMORY_KV;
    delete process.env.SESSION_SECRET;
});

describe('Town Hall Honor-Seal mercenaries are retired', { concurrency: false }, () => {
    it('refuses a new hire with the War Map pointer, and charges nothing', async () => {
        const before = await kv.get(WAR_KEY);
        const out = await hire(HIRER);
        assert.equal(out.statusCode, 410);
        assert.equal(out.body?.error, retiredMessage);
        assert.equal(retiredMessage, 'Village-war mercenaries are now hired as AI bands from the War Map.');
        assert.equal(await seals(HIRER), 800);
        assert.deepEqual(await kv.get(WAR_KEY), before, 'the war row is untouched');
    });

    it('finishes a hire whose Honor Seals were already paid: the strike lands, once', async () => {
        const now = Date.now();
        await strandHire(now, 'before-activation');
        assert.equal(await seals(HIRER), 650, 'paid before the crash');
        assert.equal(await warHp(), 5_000, 'but the strike never landed');

        const replay = await hire(HIRER);
        assert.equal(replay.statusCode, 200, JSON.stringify(replay.body));
        assert.equal(replay.body?.replayed, true);
        assert.equal(replay.body?.balance, 650);
        assert.equal(replay.body?.dealt, 120);
        assert.ok(Number(replay.body?._saveVersion) > 1, 'echoes the hirer\'s committed save version');
        assert.equal(await warHp(), 4_880);
        assert.equal((await kv.get<Json>(WAR_KEY))?.[saga.WAR_MERCENARY_FUNDING_FIELD], undefined, 'unfrozen');

        // A lost-response retry reads its receipt back; nothing moves again.
        const again = await hire(HIRER);
        assert.equal(again.statusCode, 200);
        assert.equal(again.body?.replayed, true);
        assert.equal(await seals(HIRER), 650);
        assert.equal(await warHp(), 4_880);
    });

    it('aborts a hire that never debited when anyone at war calls: unfrozen, nothing charged', async () => {
        const now = Date.now();
        await strandHire(now, 'before-debit');
        const out = await hire(NEIGHBOUR);
        assert.equal(out.statusCode, 410, 'the neighbour is refused a new hire …');
        assert.equal((await kv.get<Json>(WAR_KEY))?.[saga.WAR_MERCENARY_FUNDING_FIELD], undefined, '… but the war row is free again');
        assert.equal(await warHp(), 5_000);
        assert.equal(await seals(HIRER), 800, 'the hirer paid nothing');
        const receipts = ((await kv.get<Json>(`save:${HIRER}`))?.character as Json)?.[saga.PLAYER_WAR_MERCENARY_RECEIPTS_FIELD] as Json;
        assert.deepEqual(Object.values(receipts ?? {}).map((r) => (r as Json).state), ['aborted'], 'fenced, so a paused worker can never debit it later');
        // And the hirer's own retry is refused too — the hire never happened.
        assert.equal((await hire(HIRER)).statusCode, 410);
        assert.equal(await seals(HIRER), 800);
    });

    it('the mercenary tick sweeps a stranded hire without any caller', async () => {
        const now = Date.now();
        await strandHire(now, 'before-activation');
        const swept = await saga.sweepRetiredWarMercenaryHires(Date.now());
        assert.deepEqual(swept, { settled: 1, pending: 0 });
        assert.equal((await kv.get<Json>(WAR_KEY))?.[saga.WAR_MERCENARY_FUNDING_FIELD], undefined);
        assert.equal(await warHp(), 4_880);
        assert.equal(await seals(HIRER), 650, 'charged exactly once');
        assert.deepEqual(await saga.sweepRetiredWarMercenaryHires(Date.now()), { settled: 0, pending: 0 }, 'idempotent');
    });

    it('the sweep aborts an unpaid hire the same way', async () => {
        const now = Date.now();
        await strandHire(now, 'before-debit');
        assert.deepEqual(await saga.sweepRetiredWarMercenaryHires(Date.now()), { settled: 1, pending: 0 });
        assert.equal((await kv.get<Json>(WAR_KEY))?.[saga.WAR_MERCENARY_FUNDING_FIELD], undefined);
        assert.equal(await warHp(), 5_000);
        assert.equal(await seals(HIRER), 800);
    });
});
