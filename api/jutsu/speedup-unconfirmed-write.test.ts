import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = randomBytes(32).toString('hex');

/*
 * The Logistician weekly free speedup is claimed (NX key) inside the save
 * mutation, ahead of the write. The handler used to give the claim back on ANY
 * thrown error, including a write that threw after it had landed (lost
 * acknowledgement, unreadable read-back): the lesson was finished AND the
 * week's claim was free again, so the free speedup could be used repeatedly.
 * The claim now goes back only when the stored save provably did not move.
 */

type Handler = (req: never, res: never) => Promise<unknown>;
type Reply = { status: number; body: Record<string, unknown> };

const PLAYER = 'speedupunconfirmed';

let kv: typeof import('../_storage.js').kv;
let speedup: Handler;
let logisticianKey: typeof import('./speedup.js').logisticianKey;
let token: string;

before(async () => {
    ({ kv } = await import('../_storage.js'));
    const { issuePlayerToken } = await import('../_auth.js');
    token = String(issuePlayerToken(PLAYER));
    const mod = await import('./speedup.js');
    speedup = mod.default as unknown as Handler;
    logisticianKey = mod.logisticianKey;
});

after(async () => {
    await kv.del(`save:${PLAYER}`, logisticianKey(PLAYER, Date.now()));
});

async function seed() {
    await kv.del(logisticianKey(PLAYER, Date.now()));
    await kv.set(`save:${PLAYER}`, {
        character: { name: PLAYER, level: 50, ryo: 1_000, honorSeals: 40, village: 'Moonshadow Village',
            profession: 'vanguard', professionRank: 1, masterySpec: { 'seal-train-cost': 2, 'seal-speedup': 2, logistician: 1 } },
        activeJutsuTraining: { jutsuId: 'starter-nin-earth-1', endsAt: Date.now() + 30 * 60_000 },
        _saveVersion: 1,
    });
}

async function freeSpeedup(): Promise<Reply> {
    const reply: Reply = { status: 200, body: {} };
    const res = {
        setHeader: () => res,
        status: (status: number) => { reply.status = status; return res; },
        json: (payload: Record<string, unknown>) => { reply.body = payload; return res; },
        end: () => res,
    };
    await speedup({ method: 'POST', body: { playerName: PLAYER, free: true },
        headers: { 'content-type': 'application/json', 'x-player-name': PLAYER, 'x-player-token': token },
        socket: { remoteAddress: '127.0.0.1' } } as never, res as never);
    return reply;
}

type Store = {
    compareSet: (key: string, expected: unknown, value: unknown, options?: unknown) => Promise<boolean>;
    get: (key: string) => Promise<unknown>;
};

describe('jutsu speedup free claim and a save write that cannot be confirmed', { concurrency: false }, () => {
    it('a write that landed but cannot be read back keeps the weekly claim spent', async () => {
        await seed();
        const store = kv as unknown as Store;
        const originalSet = store.compareSet;
        const originalGet = store.get;
        let armed = true;
        let unreadable = false;
        // The write lands, its acknowledgement is lost, and the commit's own read-back fails once.
        store.compareSet = async (key, expected, value, options) => {
            const landed = await originalSet.call(kv, key, expected, value, options);
            if (armed && key === `save:${PLAYER}`) { armed = false; unreadable = true; throw new Error('ack lost'); }
            return landed;
        };
        store.get = async (key) => {
            if (unreadable && key === `save:${PLAYER}`) { unreadable = false; throw new Error('read-back down'); }
            return originalGet.call(kv, key);
        };
        try {
            assert.equal((await freeSpeedup()).status, 500);
        } finally {
            store.compareSet = originalSet;
            store.get = originalGet;
        }
        const stored = await kv.get<{ activeJutsuTraining: { endsAt: number } }>(`save:${PLAYER}`);
        assert.ok((stored?.activeJutsuTraining.endsAt ?? Infinity) <= Date.now(), 'the write did land: the lesson is finished');
        assert.ok(await kv.get(logisticianKey(PLAYER, Date.now())), 'the week\'s claim stays spent');

        // Give the player a fresh lesson: the free speedup must still be refused this week.
        const record = await kv.get<Record<string, unknown>>(`save:${PLAYER}`);
        await kv.set(`save:${PLAYER}`, { ...record, activeJutsuTraining: { jutsuId: 'starter-nin-earth-1', endsAt: Date.now() + 30 * 60_000 } });
        assert.equal((await freeSpeedup()).status, 409, 'no second free speedup');
    });

    it('a write that fails without landing hands the claim back', async () => {
        await seed();
        const store = kv as unknown as Store;
        const originalSet = store.compareSet;
        store.compareSet = async () => { throw new Error('socket hang up'); };
        try {
            assert.equal((await freeSpeedup()).status, 500);
        } finally { store.compareSet = originalSet; }
        assert.equal(await kv.get(logisticianKey(PLAYER, Date.now())), null, 'the free speedup is still this week\'s to use');
        assert.equal((await freeSpeedup()).status, 200);
    });
});
