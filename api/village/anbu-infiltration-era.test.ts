import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it, type TestContext } from 'node:test';
import type { KvCasOp } from '../_storage.js';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.ADMIN_PASSWORD = 'anbu-era-credit-test-admin';
process.env.SESSION_SECRET = 'anbu-era-credit-test-secret-32-bytes';
const previousLegacyFlag = process.env.ENABLE_LEGACY;
process.env.ENABLE_LEGACY = '1';

/*
 * A won ANBU raid credits the era's war-battle counter after its Legacy
 * record. bumpEraContributionOnce reports a failed write as false instead of
 * throwing, and the raid used to drop that result: the report answered 200 and
 * the battle was never counted. The raid reward is saved before either credit,
 * so a failed era write now gets the same retryable 503 as a failed Legacy
 * write, and the retry counts the battle once without paying again. The first
 * case fails on the code before that change.
 */

type Json = Record<string, any>;
type Handler = (req: never, res: never) => Promise<unknown>;
type Out = { status: number; body: Json };

const SECTOR = 12;
const RAIDER_VILLAGE = 'Moonshadow Village';
const DEFENDER_VILLAGE = 'Frostfang Village';
const ANBU_SLUG = 'eratestanbu';

let kv: typeof import('../_storage.js').kv;
let issuePlayerToken: (name: string) => string | null;
let infiltration: Handler;
let readEraContributions: typeof import('../_era.js').readEraContributions;
let RAID_RYO_REWARD: number;
let ipSeed = 0;

before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ issuePlayerToken } = await import('../_auth.js'));
    infiltration = (await import('./anbu-infiltration.js')).default as unknown as Handler;
    ({ readEraContributions } = await import('../_era.js'));
    ({ RAID_RYO_REWARD } = await import('../_anbu-infiltration.js'));
});

beforeEach(async () => {
    const keys = await kv.keys('*');
    if (keys.length) await kv.del(...keys);
});

after(async () => {
    const keys = await kv.keys('*');
    if (keys.length) await kv.del(...keys);
    delete process.env.ADMIN_PASSWORD;
    delete process.env.SHINOBIX_QA_MEMORY_KV;
    delete process.env.SESSION_SECRET;
    if (previousLegacyFlag === undefined) delete process.env.ENABLE_LEGACY;
    else process.env.ENABLE_LEGACY = previousLegacyFlag;
});

async function call(player: string, body: Json, admin = false): Promise<Out> {
    const out: Out = { status: 200, body: {} };
    const res = {
        setHeader: () => res,
        status: (code: number) => { out.status = code; return res; },
        json: (value: Json) => { out.body = value; return res; },
        end: () => res,
    };
    const ip = `10.94.0.${(++ipSeed % 250) + 1}`;
    const auth: Json = admin
        ? { 'x-admin-password': process.env.ADMIN_PASSWORD }
        : { 'x-player-name': player, 'x-player-token': issuePlayerToken(player) ?? '' };
    await infiltration({
        method: 'POST',
        body: { playerName: player, ...body },
        query: {},
        headers: { 'content-type': 'application/json', 'x-forwarded-for': ip, ...auth },
        socket: { remoteAddress: ip },
    } as never, res as never);
    return out;
}

async function seedVault(raider: string): Promise<void> {
    await kv.set(`world:territory:${SECTOR}`, { sector: SECTOR, ownerVillage: DEFENDER_VILLAGE, updatedAt: Date.now() });
    await kv.set(`save:${raider}`, {
        _saveVersion: 1,
        character: {
            name: raider, village: RAIDER_VILLAGE, level: 100,
            maxHp: 9_000, hp: 9_000, maxChakra: 500, chakra: 500, maxStamina: 500, stamina: 500,
            stats: {}, jutsu: [], pvpItems: [], equipment: {}, inventory: [], itemStacks: [],
        },
    });
    await kv.set('game:village-state:frostfangvillage', { anbuAppointees: [ANBU_SLUG] });
    await kv.set(`save:${ANBU_SLUG}`, {
        character: {
            name: 'Frostfang Anbu', village: DEFENDER_VILLAGE, level: 100,
            maxHp: 12_000, hp: 12_000, maxChakra: 1_000, maxStamina: 1_000,
            stats: {}, jutsu: [], pvpItems: [], equipment: {},
        },
    });
}

/** Start as admin (no stronghold walk, level gate or daily attempt), then end
 *  the fight in the raider's favour as the engine would. The run is the raider's. */
async function wonRaid(raider: string): Promise<string> {
    const started = await call(raider, { action: 'start', sector: SECTOR }, true);
    assert.equal(started.status, 200, JSON.stringify(started.body));
    const runId = String(started.body.runId);
    const key = `solo-pve:${runId}`;
    const session = await kv.get<Json>(key);
    if (!session) throw new Error('session not found');
    await kv.set(key, {
        ...session,
        status: 'done', winner: 'player', outcome: 'win', itemsUsed: {},
        terminalEvidence: {
            finishedAt: Date.now(), finalMoveToken: 'era-test-terminal', finalVersion: Number(session.version ?? 1), finalEventSeq: 0,
            winner: 'player', outcome: 'win', itemsUsed: {}, settlementState: 'pending',
        },
    });
    return runId;
}

/** Fail every era war-battle write: the one-row receipt hash, and the receipt
 *  row plus counter shard of docs/SHARED_HASH_ROW_SPLIT_PLAN.md §5. */
function failEraWarBattleWrites(t: TestContext): () => void {
    const originalHset = kv.hset.bind(kv);
    const hset = t.mock.method(kv, 'hset', async (key: string, fields: Record<string, unknown>) => {
        if (key === 'era:contrib-receipts:warBattles') throw new Error('injected era war-battle write failure');
        return originalHset(key, fields);
    });
    type Many = (ops: readonly KvCasOp[]) => Promise<boolean>;
    const originalMany = kv.compareSetMany?.bind(kv) as Many | undefined;
    const many = originalMany && t.mock.method(kv as unknown as { compareSetMany: Many }, 'compareSetMany', async (ops: readonly KvCasOp[]) => {
        if (ops.some((op) => op.key.startsWith('era:receipt:warBattles:'))) throw new Error('injected era war-battle write failure');
        return originalMany(ops);
    });
    return () => {
        hset.mock.restore();
        if (many) many.mock.restore();
    };
}

async function ryo(name: string): Promise<number> {
    return Number((await kv.get<Json>(`save:${name}`))?.character?.ryo ?? 0);
}

async function raidsCompleted(name: string): Promise<number> {
    return Number((await kv.get<Json>(`legacy:stats:${name}`))?.raidsCompleted ?? 0);
}

describe('ANBU raid: the era war-battle credit', { concurrency: false }, () => {
    it('a failed era write keeps the won report retryable; the retry counts the battle once and never pays again', async (t) => {
        const raider = 'anbueracredit';
        await seedVault(raider);
        const runId = await wonRaid(raider);

        const restore = failEraWarBattleWrites(t);
        const pending = await call(raider, { action: 'report', runId });
        restore();
        assert.equal(pending.status, 503, `it used to answer 200 and drop the battle: ${JSON.stringify(pending.body)}`);
        assert.equal(pending.body.code, 'legacy-delivery-pending');
        assert.equal(pending.body.retryable, true);
        assert.equal(await ryo(raider), RAID_RYO_REWARD, 'the raid reward was saved before the era credit');
        const legacyRaids = await raidsCompleted(raider);
        assert.ok(legacyRaids >= 1, 'Legacy landed before the era write failed');
        assert.equal((await readEraContributions()).warBattles, 0);

        const retried = await call(raider, { action: 'report', runId });
        assert.equal(retried.status, 200, JSON.stringify(retried.body));
        assert.equal(retried.body.won, true);
        assert.equal(retried.body.ryo, RAID_RYO_REWARD, 'the retry answers with the settled reward');
        assert.equal(await ryo(raider), RAID_RYO_REWARD, 'and never pays it again');
        assert.equal(await raidsCompleted(raider), legacyRaids, 'nor credits Legacy again');
        assert.equal((await readEraContributions()).warBattles, 1, 'the retry counts the war battle');

        assert.equal((await call(raider, { action: 'report', runId })).status, 200);
        assert.equal((await readEraContributions()).warBattles, 1, 'a replay never counts the battle twice');
    });

    it('a healthy era write counts a won raid once, at the first report', async () => {
        const raider = 'anbuerahealthy';
        await seedVault(raider);
        const runId = await wonRaid(raider);

        const reported = await call(raider, { action: 'report', runId });
        assert.equal(reported.status, 200, JSON.stringify(reported.body));
        assert.equal((await readEraContributions()).warBattles, 1);
        assert.equal((await call(raider, { action: 'report', runId })).status, 200);
        assert.equal((await readEraContributions()).warBattles, 1);
    });
});
