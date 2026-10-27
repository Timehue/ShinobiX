process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.ADMIN_PASSWORD = 'explore-unconfirmed-admin';
delete process.env.DISABLE_VILLAGE_STORES;

import { after, before, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import type { KvCasOp } from '../_storage.js';

/*
 * world/explore reserves a slot in the shared sector pool inside the save
 * mutation and hands it back when the handler fails. The catch released it on
 * ANY thrown error, including a save write that threw after it had landed
 * (lost acknowledgement, unreadable read-back): the player then held a
 * committed exploration the shared counter no longer counted, and the same-id
 * retry replays the receipt without reserving again, so the slot was refunded
 * for good. The reservation now goes back only when the stored save provably
 * did not move.
 */

type Json = Record<string, unknown>;
type Handler = (req: never, res: never) => Promise<unknown>;
type Many = (ops: readonly KvCasOp[]) => Promise<boolean>;

let kv: typeof import('../_storage.js').kv;
let handler: Handler;
let sectorPoolKey: typeof import('./_sector-pool.js').sectorPoolKey;
let cleanSectorPoolRow: typeof import('./_sector-pool.js').cleanSectorPoolRow;
let PET_BREEDING_MIGRATION_VERSION: number;

const PLAYER = 'exploreunconfirmed';
const SECTOR = 12;

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

async function explore(requestId: string) {
    const { out, res } = response();
    await handler({
        method: 'POST',
        body: { playerName: PLAYER, requestId, sector: SECTOR },
        query: {},
        headers: { 'content-type': 'application/json', 'x-admin-password': process.env.ADMIN_PASSWORD, 'x-forwarded-for': '127.0.0.96' },
        socket: { remoteAddress: '127.0.0.96' },
    } as never, res);
    return out;
}

async function poolExplores(): Promise<number> {
    return cleanSectorPoolRow(await kv.get(sectorPoolKey(SECTOR, Date.now()))).explores;
}

const holdsReceipt = async (requestId: string) => {
    const save = await kv.get<Json>(`save:${PLAYER}`);
    const receipts = ((save?.character as Json).redeemedSectorExplorations as Json[] | undefined) ?? [];
    return receipts.some((entry) => entry.id === requestId);
};

/** Fail the save write, optionally AFTER it landed (with its read-back also failing once). */
function breakSaveWrite(opts: { landed: boolean }): () => void {
    const store = kv as unknown as {
        compareSet: (key: string, expected: unknown, value: unknown, options?: unknown) => Promise<boolean>;
        compareSetMany: Many;
        get: (key: string) => Promise<unknown>;
    };
    const originalSet = store.compareSet;
    const originalMany = store.compareSetMany;
    const originalGet = store.get;
    let armed = true;
    let unreadable = false;
    const trip = () => {
        if (!armed) return false;
        armed = false;
        unreadable = opts.landed;
        return true;
    };
    store.compareSet = async (key, expected, value, options) => {
        const hit = key === `save:${PLAYER}`;
        if (hit && !opts.landed && trip()) throw new Error('socket hang up');
        const result = await originalSet.call(kv, key, expected, value, options);
        if (hit && opts.landed && trip()) throw new Error('ack lost');
        return result;
    };
    store.compareSetMany = async (ops) => {
        const hit = ops.some((op) => op.key === `save:${PLAYER}`);
        if (hit && !opts.landed && trip()) throw new Error('socket hang up');
        const result = await originalMany.call(kv, ops);
        if (hit && opts.landed && trip()) throw new Error('ack lost');
        return result;
    };
    store.get = async (key) => {
        if (unreadable && key === `save:${PLAYER}`) { unreadable = false; throw new Error('read-back down'); }
        return originalGet.call(kv, key);
    };
    return () => {
        store.compareSet = originalSet;
        store.compareSetMany = originalMany;
        store.get = originalGet;
    };
}

before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ sectorPoolKey, cleanSectorPoolRow } = await import('./_sector-pool.js'));
    ({ PET_BREEDING_MIGRATION_VERSION } = await import('../pet/_owned-pet.js'));
    handler = (await import('./explore.js')).default as unknown as Handler;
    // The pool row is keyed by the UTC day of Date.now(); freeze Date so a run
    // across midnight cannot split the counts between two rows.
    mock.timers.enable({ apis: ['Date'], now: Date.now() });
    await kv.set(`save:${PLAYER}`, {
        _saveVersion: 1,
        _saveAt: Date.now(),
        currentSector: SECTOR,
        character: {
            name: PLAYER, level: 12, hp: 100, maxHp: 100, chakra: 50, maxChakra: 50, stamina: 50, maxStamina: 50,
            ryo: 0, petBreedingMigrationVersion: PET_BREEDING_MIGRATION_VERSION, stats: {}, inventory: [], itemStacks: [],
        },
    });
});

after(async () => {
    mock.timers.reset();
    for (const key of await kv.keys('*')) await kv.del(key);
    delete process.env.SHINOBIX_QA_MEMORY_KV;
    delete process.env.ADMIN_PASSWORD;
});

describe('world/explore pool reservation and a save write that cannot be confirmed', { concurrency: false }, () => {
    it('a write that landed but cannot be read back keeps the pool debit; the same-id retry replays without a second one', async () => {
        const requestId = 'explore-unconf-0001';
        const before = await poolExplores();
        const restore = breakSaveWrite({ landed: true });
        let out;
        try { out = await explore(requestId); } finally { restore(); }
        assert.equal(out.statusCode, 500, JSON.stringify(out.body));
        assert.equal(await holdsReceipt(requestId), true, 'the write did land');
        assert.equal(await poolExplores(), before + 1, 'a committed exploration keeps its shared-sector debit');

        const replay = await explore(requestId);
        assert.equal(replay.statusCode, 200, JSON.stringify(replay.body));
        assert.equal(replay.body?.replayed, true);
        assert.equal(await poolExplores(), before + 1, 'the replay reserves nothing new');
    });

    it('a write that fails without landing hands the pool slot back', async () => {
        const requestId = 'explore-unconf-0002';
        const before = await poolExplores();
        const restore = breakSaveWrite({ landed: false });
        let out;
        try { out = await explore(requestId); } finally { restore(); }
        assert.equal(out.statusCode, 500, JSON.stringify(out.body));
        assert.equal(await holdsReceipt(requestId), false, 'nothing was written');
        assert.equal(await poolExplores(), before, 'the reservation was handed back');

        const retry = await explore(requestId);
        assert.equal(retry.statusCode, 200, JSON.stringify(retry.body));
        assert.equal(await poolExplores(), before + 1, 'the retry reserves its own slot');
    });
});
