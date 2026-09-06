process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.ADMIN_PASSWORD = 'explore-pool-commit-admin';
delete process.env.DISABLE_VILLAGE_STORES;

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';

/*
 * N05 — a committed exploration must keep its shared-sector debit.
 *
 * The handler reserves a slot in the sector pool INSIDE the save mutation, then
 * does secondary work (durable receipt, field progress, pending-chest mirror)
 * after the mutation commits. Its catch used to release the slot on any
 * secondary failure — but the save already held the reward, the discovery and
 * the receipt, and the same-id retry replays that receipt without reserving
 * again. The sector counter was then one short for the rest of the day.
 */

type Json = Record<string, unknown>;
type Handler = (req: never, res: never) => Promise<unknown>;

let kv: typeof import('../_storage.js').kv;
let handler: Handler;
let sectorPoolKey: typeof import('./_sector-pool.js').sectorPoolKey;
let cleanSectorPoolRow: typeof import('./_sector-pool.js').cleanSectorPoolRow;
let PET_BREEDING_MIGRATION_VERSION: number;

const PLAYER = 'explorepoolowner';
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
        headers: { 'content-type': 'application/json', 'x-admin-password': process.env.ADMIN_PASSWORD, 'x-forwarded-for': '127.0.0.93' },
        socket: { remoteAddress: '127.0.0.93' },
    } as never, res);
    return out;
}

async function poolExplores(): Promise<number> {
    return cleanSectorPoolRow(await kv.get(sectorPoolKey(SECTOR, Date.now()))).explores;
}

before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ sectorPoolKey, cleanSectorPoolRow } = await import('./_sector-pool.js'));
    ({ PET_BREEDING_MIGRATION_VERSION } = await import('../pet/_owned-pet.js'));
    handler = (await import('./explore.js')).default as unknown as Handler;
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
    for (const key of await kv.keys('*')) await kv.del(key);
    delete process.env.SHINOBIX_QA_MEMORY_KV;
    delete process.env.ADMIN_PASSWORD;
});

describe('world/explore keeps a committed reservation through a secondary failure', { concurrency: false }, () => {
    it('post-commit failure → 503 retryable, debit retained; same-id replay completes without a second debit', async () => {
        const requestId = 'explore-commit-0001';
        const originalSet = kv.set;
        (kv as { set: unknown }).set = async (key: string, value: unknown, opts?: unknown) => {
            if (key.startsWith('world-explore-receipt:')) throw new Error('durable-receipt-down');
            return (originalSet as (k: string, v: unknown, o?: unknown) => Promise<unknown>).call(kv, key, value, opts);
        };
        let out;
        try {
            out = await explore(requestId);
        } finally {
            (kv as { set: unknown }).set = originalSet;
        }
        assert.equal(out.statusCode, 503, JSON.stringify(out.body));
        assert.equal(out.body?.retryable, true);
        assert.equal(out.body?.requestId, requestId);

        const save = await kv.get<Json>(`save:${PLAYER}`);
        const receipts = (save?.character as Json).redeemedSectorExplorations as Json[];
        assert.equal(receipts?.some((entry) => entry.id === requestId), true, 'the primary operation committed');
        assert.equal(await poolExplores(), 1, 'a committed exploration keeps its shared-sector debit');

        const replay = await explore(requestId);
        assert.equal(replay.statusCode, 200, JSON.stringify(replay.body));
        assert.equal(replay.body?.replayed, true);
        assert.equal(await poolExplores(), 1, 'the replay reserves nothing new');
        assert.ok(await kv.get(`world-explore-receipt:${PLAYER}:${requestId}`), 'the durable receipt was completed on retry');
        assert.equal(((await kv.get<Json>(`save:${PLAYER}`))?.character as Json).serverExploresToday, 1, 'one exploration, counted once');
    });

    it('a fresh exploration still debits its own slot', async () => {
        const out = await explore('explore-commit-0002');
        assert.equal(out.statusCode, 200, JSON.stringify(out.body));
        assert.equal(await poolExplores(), 2);
    });
});
