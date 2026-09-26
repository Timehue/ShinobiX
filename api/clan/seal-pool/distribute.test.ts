import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, test } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'seal-pool-distribute-test-secret-32-bytes';
process.env.ADMIN_PASSWORD = 'seal-pool-distribute-test-admin';

/*
 * A founder's gift from the clan Honor Seal pool, on the real handler and
 * storage adapter. The handler used to debit the pool, credit the member in a
 * second step, and refund the pool whenever that credit threw. A credit write
 * that landed and then threw was refunded too, so the member kept the Seals
 * and the pool got them back. It also took no request id, so a retry after a
 * lost answer gave the Seals twice. Every case below states the pool and the
 * member's balance afterwards.
 */

type Handler = (req: never, res: never) => Promise<unknown>;
type Out = { statusCode: number; body?: Record<string, unknown> };
type Pool = { balance: number; log: Array<{ kind: string }> };

const LEADER = 'sealfounder';
const MEMBER = 'sealmember';
const OFFICER = 'sealofficer';
const OUTSIDER = 'sealoutsider';
const DONOR = 'sealvanguard';
const CLAN = 'Ashwind';
const POOL_KEY = `clan-seal-pool:${CLAN.toLowerCase()}`;
const MEMBER_KEY = `save:${MEMBER}`;

let kv: typeof import('../../_storage.js').kv;
let distribute: Handler;
let donate: Handler;
let issuePlayerToken: (name: string) => string | null;
let resetRateLimits: () => void;

before(async () => {
    ({ kv } = await import('../../_storage.js'));
    ({ issuePlayerToken } = await import('../../_auth.js'));
    ({ __resetRateLimitsForTest: resetRateLimits } = await import('../../_ratelimit.js'));
    distribute = (await import('./distribute.js')).default as unknown as Handler;
    donate = (await import('./donate.js')).default as unknown as Handler;
});

beforeEach(async () => {
    resetRateLimits();
    const keys = await kv.keys('*');
    if (keys.length) await kv.del(...keys);
    await kv.set(`save:${LEADER}`, { _saveVersion: 1, character: { name: 'Seal Founder', clan: CLAN, clanFounder: true, honorSeals: 0 } });
    // A member far ahead in save version: the founder's client must never see it.
    await kv.set(MEMBER_KEY, { _saveVersion: 900, character: { name: 'Seal Member', clan: CLAN, honorSeals: 5 } });
    await kv.set(`save:${OFFICER}`, { _saveVersion: 1, character: { name: 'Seal Officer', clan: CLAN, honorSeals: 0 } });
    await kv.set(`save:${OUTSIDER}`, { _saveVersion: 1, character: { name: 'Seal Outsider', clan: 'Other', honorSeals: 0 } });
    await kv.set(`save:${DONOR}`, { _saveVersion: 1, character: { name: 'Seal Vanguard', clan: CLAN, profession: 'vanguard', honorSeals: 100 } });
    await kv.set(POOL_KEY, { clanName: CLAN, balance: 100, log: [] });
});

after(async () => {
    const keys = await kv.keys('*');
    if (keys.length) await kv.del(...keys);
    delete process.env.SHINOBIX_QA_MEMORY_KV;
    delete process.env.SESSION_SECRET;
    delete process.env.ADMIN_PASSWORD;
});

async function callAs(handler: Handler, tokenOwner: string, body: Record<string, unknown>): Promise<Out> {
    const out: Out = { statusCode: 200 };
    const res = {
        setHeader: () => res,
        status: (statusCode: number) => { out.statusCode = statusCode; return res; },
        json: (payload: Record<string, unknown>) => { out.body = payload; return res; },
        end: () => res,
    };
    await handler({
        method: 'POST',
        body,
        headers: { 'x-player-name': tokenOwner, 'x-player-token': issuePlayerToken(tokenOwner) ?? '' },
        socket: { remoteAddress: '127.0.0.1' },
    } as never, res as never);
    return out;
}

/** The founder gives `amount` Seals to `recipientName`. */
function give(body: Record<string, unknown>, tokenOwner = LEADER): Promise<Out> {
    return callAs(distribute, tokenOwner, { leaderName: tokenOwner, recipientName: MEMBER, ...body });
}

async function balances(): Promise<{ pool: number; member: number }> {
    const pool = await kv.get<Pool>(POOL_KEY);
    const member = await kv.get<{ character?: { honorSeals?: number } }>(MEMBER_KEY);
    return { pool: Number(pool?.balance), member: Number(member?.character?.honorSeals) };
}

async function poolLog(): Promise<string[]> {
    return ((await kv.get<Pool>(POOL_KEY))?.log ?? []).map((entry) => entry.kind);
}

/**
 * The member's save write throws once. `landed` decides whether the write
 * reached storage first, and the readback that would tell the two apart
 * fails as well, so the handler cannot know which happened.
 */
function ambiguousCreditOnce(landed: boolean): () => void {
    const originalCompareSet = kv.compareSet.bind(kv);
    const originalSet = kv.set.bind(kv);
    const originalGet = kv.get.bind(kv);
    let armed = true;
    let blindReadback = false;
    const fail = () => {
        armed = false;
        blindReadback = true;
        throw new Error('injected: member save write timed out');
    };
    kv.compareSet = (async (key: string, expected: unknown, next: unknown) => {
        if (!armed || key !== MEMBER_KEY) return originalCompareSet(key, expected, next);
        if (landed) await originalCompareSet(key, expected, next);
        return fail();
    }) as typeof kv.compareSet;
    // The handler before this fix wrote the member save with a plain set.
    kv.set = (async (key: string, value: unknown, options?: unknown) => {
        if (!armed || key !== MEMBER_KEY) return originalSet(key, value, options as never);
        if (landed) await originalSet(key, value, options as never);
        return fail();
    }) as typeof kv.set;
    kv.get = (async (key: string) => {
        if (blindReadback && key === MEMBER_KEY) {
            blindReadback = false;
            throw new Error('injected: member save readback failed');
        }
        return originalGet(key);
    }) as typeof kv.get;
    return () => {
        kv.compareSet = originalCompareSet;
        kv.set = originalSet;
        kv.get = originalGet;
    };
}

describe('clan seal-pool distribution settles exactly once', { concurrency: false }, () => {
    test('a gift moves the Seals once, and its retry returns the same answer', async () => {
        const first = await give({ amount: 30, requestId: 'seal-give-once-0001' });
        assert.equal(first.statusCode, 200, JSON.stringify(first.body));
        assert.equal(first.body?.distributed, 30);
        assert.equal(first.body?.poolBalance, 70);
        assert.equal('_saveVersion' in (first.body ?? {}), false, "the member's save version must never reach the founder's client");
        assert.deepEqual(await balances(), { pool: 70, member: 35 });

        const retry = await give({ amount: 30, requestId: 'seal-give-once-0001' });
        assert.equal(retry.statusCode, 200);
        assert.deepEqual(retry.body, first.body);
        assert.deepEqual(await balances(), { pool: 70, member: 35 }, 'the retry moved nothing');
        assert.deepEqual(await poolLog(), ['distribute']);
    });

    test('concurrent duplicates move the Seals once', async () => {
        const answers = await Promise.all(Array.from({ length: 6 }, () => give({ amount: 30, requestId: 'seal-give-burst-0001' })));
        assert.ok(answers.every((answer) => answer.statusCode === 200 || answer.statusCode === 503), JSON.stringify(answers));
        assert.ok(answers.some((answer) => answer.statusCode === 200));
        assert.deepEqual(await balances(), { pool: 70, member: 35 });
        assert.deepEqual(await poolLog(), ['distribute']);
    });

    test('a pool write that fails moves nothing, and the retry gives once', async () => {
        const originalSet = kv.set.bind(kv);
        let armed = true;
        kv.set = (async (key: string, value: unknown, options?: unknown) => {
            if (armed && key === POOL_KEY) {
                armed = false;
                throw new Error('injected: pool write failed');
            }
            return originalSet(key, value, options as never);
        }) as typeof kv.set;
        try {
            const failed = await give({ amount: 30, requestId: 'seal-give-poolfail-01' });
            assert.equal(failed.statusCode, 500);
        } finally {
            kv.set = originalSet;
        }
        assert.deepEqual(await balances(), { pool: 100, member: 5 });

        const retry = await give({ amount: 30, requestId: 'seal-give-poolfail-01' });
        assert.equal(retry.statusCode, 200, JSON.stringify(retry.body));
        assert.deepEqual(await balances(), { pool: 70, member: 35 });
    });

    test('a credit that landed but whose answer was lost is never refunded, so no Seals are minted', async () => {
        const restore = ambiguousCreditOnce(true);
        let failed: Out;
        try {
            failed = await give({ amount: 30, requestId: 'seal-give-landed-001' });
        } finally {
            restore();
        }
        // Before the fix the pool took the 30 back while the member kept them.
        assert.deepEqual(await balances(), { pool: 70, member: 35 });
        assert.deepEqual(await poolLog(), ['distribute']);
        assert.equal(failed.statusCode, 500);

        const retry = await give({ amount: 30, requestId: 'seal-give-landed-001' });
        assert.equal(retry.statusCode, 200, JSON.stringify(retry.body));
        assert.deepEqual(await balances(), { pool: 70, member: 35 }, 'the retry finishes without a second credit');
    });

    test('a credit that did not land keeps the debit, and the retry credits once', async () => {
        const restore = ambiguousCreditOnce(false);
        try {
            const failed = await give({ amount: 30, requestId: 'seal-give-unlanded-1' });
            assert.equal(failed.statusCode, 500);
        } finally {
            restore();
        }
        assert.deepEqual(await balances(), { pool: 70, member: 5 });

        const retry = await give({ amount: 30, requestId: 'seal-give-unlanded-1' });
        assert.equal(retry.statusCode, 200, JSON.stringify(retry.body));
        assert.deepEqual(await balances(), { pool: 70, member: 35 });
    });

    test('a lost completion is finished by the retry without moving anything again', async () => {
        const originalSet = kv.set.bind(kv);
        let armed = true;
        kv.set = (async (key: string, value: unknown, options?: unknown) => {
            if (armed && key.startsWith('economy-settlement:clan-seal-distribute-')
                && (value as { state?: string } | null)?.state === 'completed') {
                armed = false;
                throw new Error('injected: journal completion failed');
            }
            return originalSet(key, value, options as never);
        }) as typeof kv.set;
        try {
            const failed = await give({ amount: 30, requestId: 'seal-give-journal-01' });
            assert.equal(failed.statusCode, 500);
        } finally {
            kv.set = originalSet;
        }
        assert.deepEqual(await balances(), { pool: 70, member: 35 });

        const retry = await give({ amount: 30, requestId: 'seal-give-journal-01' });
        assert.equal(retry.statusCode, 200, JSON.stringify(retry.body));
        assert.deepEqual(await balances(), { pool: 70, member: 35 });
    });

    test('a gift that already left the pool is finished after the founder steps down and leaves', async () => {
        const restore = ambiguousCreditOnce(false);
        try {
            assert.equal((await give({ amount: 30, requestId: 'seal-give-stepdown-1' })).statusCode, 500);
        } finally {
            restore();
        }
        await kv.set(`save:${LEADER}`, { _saveVersion: 2, character: { name: 'Seal Founder', clan: '', clanFounder: false, honorSeals: 0 } });

        const retry = await give({ amount: 30, requestId: 'seal-give-stepdown-1' });
        assert.equal(retry.statusCode, 200, JSON.stringify(retry.body));
        assert.deepEqual(await balances(), { pool: 70, member: 35 });
    });

    test('short pools, forged identities, non-founders, outsiders and reused ids move nothing', async () => {
        const short = await give({ amount: 200, requestId: 'seal-give-short-0001' });
        assert.equal(short.statusCode, 400);
        assert.equal(short.body?.available, 100);

        const forged = await callAs(distribute, OFFICER, { leaderName: LEADER, recipientName: MEMBER, amount: 10, requestId: 'seal-give-forged-001' });
        assert.equal(forged.statusCode, 403, 'a token for one player cannot give as another');
        const notFounder = await give({ amount: 10, requestId: 'seal-give-notfound-1' }, OFFICER);
        assert.equal(notFounder.statusCode, 403);
        const outsider = await give({ recipientName: OUTSIDER, amount: 10, requestId: 'seal-give-outsider-1' });
        assert.equal(outsider.statusCode, 400);
        const ghost = await give({ recipientName: 'sealghost', amount: 10, requestId: 'seal-give-ghost-0001' });
        assert.equal(ghost.statusCode, 404);
        assert.deepEqual(await balances(), { pool: 100, member: 5 });

        assert.equal((await give({ amount: 10, requestId: 'seal-give-reused-001' })).statusCode, 200);
        const reused = await give({ amount: 11, requestId: 'seal-give-reused-001' });
        assert.equal(reused.statusCode, 409);
        const redirected = await give({ recipientName: OFFICER, amount: 10, requestId: 'seal-give-reused-001' });
        assert.equal(redirected.statusCode, 409);
        assert.deepEqual(await balances(), { pool: 90, member: 15 });
    });

    test('concurrent duplicate donations donate once', async () => {
        const donate10 = () => callAs(donate, DONOR, { playerName: DONOR, amount: 10, requestId: 'seal-donate-burst-0001' });
        const answers = await Promise.all(Array.from({ length: 5 }, donate10));
        assert.ok(answers.some((answer) => answer.statusCode === 200), JSON.stringify(answers));
        assert.equal((await kv.get<{ character: { honorSeals: number } }>(`save:${DONOR}`))?.character.honorSeals, 90);
        assert.equal((await kv.get<Pool>(POOL_KEY))?.balance, 110);
    });

    test('a donation over the daily cap, a forged identity and a non-Vanguard move nothing', async () => {
        // The cap is half of the start-of-day balance: 50 of 100.
        const overCap = await callAs(donate, DONOR, { playerName: DONOR, amount: 51, requestId: 'seal-donate-overcap-01' });
        assert.equal(overCap.statusCode, 400);
        const forged = await callAs(donate, OFFICER, { playerName: DONOR, amount: 10, requestId: 'seal-donate-forged-001' });
        assert.equal(forged.statusCode, 403, 'a token for one player cannot donate another player\'s Seals');
        const notVanguard = await callAs(donate, MEMBER, { playerName: MEMBER, amount: 1, requestId: 'seal-donate-member-001' });
        assert.equal(notVanguard.statusCode, 403);
        assert.equal((await kv.get<{ character: { honorSeals: number } }>(`save:${DONOR}`))?.character.honorSeals, 100);
        assert.deepEqual(await balances(), { pool: 100, member: 5 });
    });

    test('a donation and a gift both lock the pool row before the player save', async () => {
        const originalSet = kv.set.bind(kv);
        const acquired: string[] = [];
        kv.set = (async (key: string, value: unknown, options?: { nx?: boolean }) => {
            const out = await originalSet(key, value, options as never);
            if (options?.nx && key.startsWith('lock:') && out) acquired.push(key);
            return out;
        }) as typeof kv.set;
        try {
            assert.equal((await give({ amount: 10, requestId: 'seal-give-order-0001' })).statusCode, 200);
            assert.equal((await callAs(donate, DONOR, { playerName: DONOR, amount: 10, requestId: 'seal-donate-order-01' })).statusCode, 200);
        } finally {
            kv.set = originalSet;
        }
        const locks = acquired.filter((key) => key === `lock:${POOL_KEY}` || key.startsWith('lock:save:'));
        assert.deepEqual(locks, [`lock:${POOL_KEY}`, `lock:${MEMBER_KEY}`, `lock:${POOL_KEY}`, `lock:save:${DONOR}`]);
    });
});
