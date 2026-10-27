import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it, mock } from 'node:test';
import type { KvCasOp } from '../_storage.js';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.ADMIN_PASSWORD = 'rift-quest-unconfirmed-admin';
delete process.env.SESSION_SECRET;

/*
 * POST /api/sector/rift-quest { action: 'complete' } burns the single-use KV
 * seal and takes one of the day's paid-clear slots inside the save mutation,
 * ahead of the payout write.
 *
 * A write that LOST its compare-and-set already put both back (onConflict). A
 * write that threw a transport error and never landed did not: there was no
 * onUnconfirmedWrite, so the seal and the slot stayed spent for a rift that was
 * never paid. The hook puts them back only when the stored save provably still
 * holds the version the decision read; a write that DID land keeps them spent,
 * so the rift cannot pay twice.
 */

type Json = Record<string, unknown>;
type Out = { statusCode: number; body?: Json };
type Many = (ops: readonly KvCasOp[]) => Promise<boolean>;

const FIXED_NOW = Date.UTC(2026, 9, 20, 12, 0, 0);
const PREFIX = 'riftunconf';
const RIFT_ID = 'rift-legacy-echo';
const RUN_TOKEN = 'run-token-abcdef12';

let kv: typeof import('../_storage.js').kv;
let handler: (req: never, res: never) => Promise<unknown>;
let WORLD_GEO_VERSION: number;
let PET_BREEDING_MIGRATION_VERSION: number;

before(async () => {
    mock.timers.enable({ apis: ['Date'], now: FIXED_NOW });
    ({ kv } = await import('../_storage.js'));
    ({ WORLD_GEO_VERSION } = await import('../../shared/sector-geo.js'));
    ({ PET_BREEDING_MIGRATION_VERSION } = await import('../pet/_owned-pet.js'));
    handler = (await import('./rift-quest.js')).default as unknown as typeof handler;
});

async function cleanup() {
    for (const pattern of [`*${PREFIX}*`]) {
        const keys = await kv.keys(pattern);
        if (keys.length) await kv.del(...keys);
    }
}
beforeEach(cleanup);
after(async () => {
    await cleanup();
    mock.timers.reset();
    delete process.env.SHINOBIX_QA_MEMORY_KV;
    delete process.env.ADMIN_PASSWORD;
});

const questKey = (name: string) => `rift-quest:${name}`;
const countKey = (name: string) => `rift-quest-count:${name}:${new Date().toISOString().slice(0, 10)}`;

async function seed(name: string) {
    const at = FIXED_NOW - 60_000;
    const seal = { id: RIFT_ID, targetSector: 12, baseline: 0, at, geoV: WORLD_GEO_VERSION, runToken: RUN_TOKEN };
    await kv.set(`save:${name}`, {
        _saveVersion: 5,
        _saveAt: FIXED_NOW,
        _regenAt: FIXED_NOW,
        activeRiftQuestSeal: seal,
        character: {
            name, level: 40, village: 'Leaf', pets: [], inventory: [], petBreedingMigrationVersion: PET_BREEDING_MIGRATION_VERSION,
            hp: 900, maxHp: 1000, chakra: 100, maxChakra: 100, stamina: 100, maxStamina: 100,
            ryo: 5_000, fateShards: 0, boneCharms: 0,
            activeRiftQuest: { id: RIFT_ID, targetSector: 12, stage: 'travel', baseline: 0, bossName: 'The Unremembered' },
            riftQuestBossReceipt: { riftId: RIFT_ID, runToken: RUN_TOKEN, combatRunId: 'combat:run-0001', acceptedAt: at, clearedAt: at + 5_000 },
        },
    });
    await kv.set(questKey(name), seal, { ex: 7 * 24 * 60 * 60 });
    return seal;
}

async function complete(name: string): Promise<Out> {
    const out: Out = { statusCode: 200 };
    const res = {
        setHeader: () => res,
        status(code: number) { out.statusCode = code; return res; },
        json(payload: Json) { out.body = payload; return res; },
        end: () => res,
    };
    await handler({
        method: 'POST',
        body: { action: 'complete', playerName: name, riftId: RIFT_ID },
        query: {},
        headers: { 'content-type': 'application/json', 'x-admin-password': process.env.ADMIN_PASSWORD, 'x-forwarded-for': '127.0.0.95' },
        socket: { remoteAddress: '127.0.0.95' },
    } as never, res as never);
    return out;
}

const ryoOf = async (name: string) => ((await kv.get<{ character: { ryo: number } }>(`save:${name}`))!.character.ryo);
const writesSave = (ops: readonly KvCasOp[], name: string) => ops.some(op => op.key === `save:${name}`);

describe('rift-quest complete and a save write that cannot be confirmed', { concurrency: false }, () => {
    it('a write that fails without landing puts the KV seal and the daily slot back, so the retry is a fresh claim', async t => {
        const name = `${PREFIX}failed`;
        const seal = await seed(name);
        const original = kv.compareSetMany!.bind(kv) as Many;
        let armed = true;
        t.mock.method(kv as unknown as { compareSetMany: Many }, 'compareSetMany', async (ops: readonly KvCasOp[]) => {
            if (armed && writesSave(ops, name)) { armed = false; throw new Error('socket hang up'); }
            return original(ops);
        });

        const failed = await complete(name);
        assert.equal(failed.statusCode, 500);
        assert.equal(await ryoOf(name), 5_000, 'nothing was paid');
        assert.deepEqual(await kv.get(questKey(name)), seal, 'the single-use KV seal was put back');
        assert.ok(!(await kv.get<number>(countKey(name))), 'the daily slot was put back');

        const retry = await complete(name);
        assert.equal(retry.body?.ok, true, JSON.stringify(retry.body));
        assert.ok((await ryoOf(name)) > 5_000);
        assert.equal(await kv.get<number>(countKey(name)), 1, 'one paid clear, one slot');
    });

    it('a write that landed but cannot be read back keeps the seal burned, so the rift never pays twice', async t => {
        const name = `${PREFIX}landed`;
        await seed(name);
        const originalMany = kv.compareSetMany!.bind(kv) as Many;
        const originalGet = kv.get.bind(kv);
        let armed = true;
        let unreadable = false;
        t.mock.method(kv as unknown as { compareSetMany: Many }, 'compareSetMany', async (ops: readonly KvCasOp[]) => {
            const landed = await originalMany(ops);
            if (armed && writesSave(ops, name)) { armed = false; unreadable = true; throw new Error('ack lost'); }
            return landed;
        });
        // The commit's own read-back of the save fails once, so the write stays unconfirmed.
        t.mock.method(kv, 'get', async (key: string) => {
            if (unreadable && key === `save:${name}`) { unreadable = false; throw new Error('read-back down'); }
            return originalGet(key);
        });

        const first = await complete(name);
        assert.equal(first.statusCode, 500);
        const paid = await ryoOf(name);
        assert.ok(paid > 5_000, 'the write did land');
        assert.equal(await kv.get(questKey(name)), null, 'the KV seal stays burned');
        assert.equal(await kv.get<number>(countKey(name)), 1, 'the daily slot stays spent');

        const retry = await complete(name);
        assert.equal(retry.body?.ok, false);
        assert.equal(await ryoOf(name), paid, 'no second payout');
    });
});
