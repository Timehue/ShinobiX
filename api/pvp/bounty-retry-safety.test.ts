import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, test } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'pvp-bounty-retry-test-secret-32-bytes!!';

/*
 * Issues #179 and #180 on the real bounty handler and storage adapter.
 *
 * #179: a placement's request id never charges twice, and a stop between the
 * charge and the escrow is finished by the retry.
 * #180: a payout used to credit the winner BEFORE removing the head, so a
 * failure between the two left the pool posted for a second battle. The head
 * now leaves the board first; every test below injects a failure at one phase
 * boundary and proves the pool pays out exactly once.
 */

type Handler = (req: never, res: never) => Promise<unknown>;
type Out = { statusCode: number; body?: Record<string, unknown> };
type Board = { bounties: Array<{ target: string; amount: number }>; pendingClaims?: Array<{ id: string; winner: string }> };

const PLACER = 'retryplacer';
const HUNTER = 'retryhunter';
const RIVAL = 'retryrival';
const TARGET = 'retrytarget';
const BOARD_KEY = 'pvp:bounties';

let kv: typeof import('../_storage.js').kv;
let handler: Handler;
let issuePlayerToken: (name: string) => string | null;
let resetRateLimits: () => void;
let settleSleeper: typeof import('./_bounty-settle.js').settleBountyForSessionlessKill;
let sweepAfterMs: number;

before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ issuePlayerToken } = await import('../_auth.js'));
    ({ __resetRateLimitsForTest: resetRateLimits } = await import('../_ratelimit.js'));
    ({ settleBountyForSessionlessKill: settleSleeper } = await import('./_bounty-settle.js'));
    ({ BOUNTY_CLAIM_SWEEP_AFTER_MS: sweepAfterMs } = await import('./_bounty-claim.js'));
    handler = (await import('./bounty.js')).default as unknown as Handler;
});

beforeEach(async () => {
    resetRateLimits();
    const keys = await kv.keys('*');
    if (keys.length) await kv.del(...keys);
    await kv.set(`save:${PLACER}`, { _saveVersion: 1, character: { name: 'Retry Placer', ryo: 50_000 } });
    await kv.set(`save:${HUNTER}`, { _saveVersion: 1, character: { name: 'Retry Hunter', ryo: 100 } });
    await kv.set(`save:${RIVAL}`, { _saveVersion: 1, character: { name: 'Retry Rival', ryo: 100 } });
    await kv.set(`save:${TARGET}`, { _saveVersion: 1, character: { name: 'Retry Target', ryo: 100 } });
});

after(async () => {
    const keys = await kv.keys('*');
    if (keys.length) await kv.del(...keys);
    delete process.env.SHINOBIX_QA_MEMORY_KV;
    delete process.env.SESSION_SECRET;
});

async function call(playerName: string, body: Record<string, unknown>): Promise<Out> {
    const out: Out = { statusCode: 200 };
    const res = {
        setHeader: () => res,
        status: (statusCode: number) => { out.statusCode = statusCode; return res; },
        json: (payload: Record<string, unknown>) => { out.body = payload; return res; },
        end: () => res,
    };
    await handler({
        method: 'POST',
        body: { ...body, playerName },
        headers: { 'x-player-name': playerName, 'x-player-token': issuePlayerToken(playerName) ?? '' },
        socket: { remoteAddress: '127.0.0.1' },
    } as never, res as never);
    return out;
}

async function seedWin(battleId: string, winnerDisplay: string): Promise<void> {
    const now = Date.now();
    await kv.set(`pvp:${battleId}`, {
        battleId,
        p1: { name: winnerDisplay, character: { name: winnerDisplay } },
        p2: { name: 'Retry Target', character: { name: 'Retry Target' } },
        status: 'done',
        winner: 'p1',
        rewardAuthority: 'world',
        joined: { p1: true, p2: true },
        baseRewards: true,
        log: [],
        createdAt: now - 5_000,
        endedAt: now - 1_000,
    });
}

const ryo = async (slug: string) => Number((await kv.get<{ character: { ryo: number } }>(`save:${slug}`))?.character.ryo);
const board = async () => (await kv.get<Board>(BOARD_KEY)) ?? { bounties: [] };
const pool = async () => (await board()).bounties.find((b) => b.target === 'Retry Target')?.amount ?? 0;

async function postBounty(amount: number, requestId?: string): Promise<Out> {
    return call(PLACER, { action: 'place', target: 'Retry Target', amount, ...(requestId ? { requestId } : {}) });
}

describe('bounty placement is retry-safe (#179)', () => {
    test('the same request id escrows once, and its retry replays the result', async () => {
        const first = await postBounty(2_000, 'bounty-place-retry-0001');
        assert.equal(first.statusCode, 200, JSON.stringify(first.body));
        const retry = await postBounty(2_000, 'bounty-place-retry-0001');
        assert.equal(retry.statusCode, 200, JSON.stringify(retry.body));
        assert.equal(retry.body?.replayed, true);
        assert.equal(await ryo(PLACER), 48_000, 'one charge');
        assert.equal(await pool(), 2_000, 'one escrow');
        const posts = ((await kv.get<Array<{ type: string }>>('game:announcements')) ?? []).filter((a) => a.type === 'bounty_placed');
        assert.equal(posts.length, 1, 'the herald posts the placement once');
    });

    test('concurrent duplicates escrow once', async () => {
        const outs = await Promise.all(Array.from({ length: 5 }, () => postBounty(3_000, 'bounty-place-dupes-0001')));
        for (const out of outs) assert.ok(out.statusCode === 200 || out.statusCode === 503, JSON.stringify(out));
        assert.equal(await ryo(PLACER), 47_000);
        assert.equal(await pool(), 3_000);
    });

    test('a stop between the charge and the escrow is finished by the retry', async (t) => {
        const originalSet = kv.set.bind(kv);
        const originalCompareSet = kv.compareSet.bind(kv);
        let broken = true;
        t.mock.method(kv, 'set', async (...args: Parameters<typeof kv.set>) => {
            if (broken && args[0] === BOARD_KEY) throw new Error('process stopped');
            return originalSet(...args);
        });
        let saveWrites = 0;
        t.mock.method(kv, 'compareSet', async (...args: Parameters<typeof kv.compareSet>) => {
            if (broken && args[0] === `save:${PLACER}` && ++saveWrites > 1) throw new Error('refund never ran');
            return originalCompareSet(...args);
        });
        const stuck = await postBounty(5_000, 'bounty-place-stopped-001');
        assert.equal(stuck.statusCode, 503, JSON.stringify(stuck.body));
        assert.equal(await ryo(PLACER), 45_000);
        assert.equal(await pool(), 0);
        broken = false;
        const retry = await postBounty(5_000, 'bounty-place-stopped-001');
        assert.equal(retry.statusCode, 200, JSON.stringify(retry.body));
        assert.equal(await ryo(PLACER), 45_000, 'no second charge');
        assert.equal(await pool(), 5_000, 'the escrow landed once');
    });
});

describe('bounty payout is two-phase (#180)', () => {
    test('a failure right after the payout cannot let a second battle collect the same pool', async (t) => {
        assert.equal((await postBounty(2_000)).statusCode, 200);
        await seedWin('bounty-180-battle-a-000001', 'Retry Hunter');
        await seedWin('bounty-180-battle-b-000001', 'Retry Rival');
        // The #180 window: whatever board write follows the winner's credit
        // fails. Keyed on the credit having landed, not on a write count, so it
        // hits the same window in the old order (credit, then remove the head)
        // and the new one (reserve the head, credit, then clean up).
        const original = kv.set.bind(kv);
        const originalGet = kv.get.bind(kv);
        t.mock.method(kv, 'set', async (...args: Parameters<typeof kv.set>) => {
            if (args[0] === BOARD_KEY) {
                const hunter = await originalGet<{ character: { ryo: number } }>(`save:${HUNTER}`);
                if (Number(hunter?.character.ryo) > 100) throw new Error('injected board write failure after payout');
            }
            return original(...args);
        });
        await call(HUNTER, { action: 'claim', battleId: 'bounty-180-battle-a-000001' });
        t.mock.restoreAll();
        assert.equal(await ryo(HUNTER), 2_100, 'the winner was paid');

        const second = await call(RIVAL, { action: 'claim', battleId: 'bounty-180-battle-b-000001' });
        assert.equal(second.statusCode, 200, JSON.stringify(second.body));
        assert.equal(second.body?.amount, 0, 'the pool already left the board');
        assert.equal(await ryo(HUNTER), 2_100, 'paid exactly once');
        assert.equal(await ryo(RIVAL), 100, 'the second battle collects nothing');
    });

    test('a failed credit keeps the pool reserved for its winner; the retry pays once', async (t) => {
        assert.equal((await postBounty(2_000)).statusCode, 200);
        await seedWin('bounty-180-credit-fails-a1', 'Retry Hunter');
        await seedWin('bounty-180-credit-fails-b1', 'Retry Rival');
        const original = kv.compareSet.bind(kv);
        let broken = true;
        t.mock.method(kv, 'compareSet', async (...args: Parameters<typeof kv.compareSet>) => {
            if (broken && args[0] === `save:${HUNTER}`) throw new Error('injected credit failure');
            return original(...args);
        });
        const failed = await call(HUNTER, { action: 'claim', battleId: 'bounty-180-credit-fails-a1' });
        assert.notEqual(failed.statusCode, 200, JSON.stringify(failed.body));
        assert.equal(await pool(), 0, 'the head is reserved, not posted');
        assert.deepEqual((await board()).pendingClaims?.map((p) => p.winner), [HUNTER]);

        const rival = await call(RIVAL, { action: 'claim', battleId: 'bounty-180-credit-fails-b1' });
        assert.equal(rival.body?.amount, 0, 'no other battle can reach the reserved pool');

        broken = false;
        const retry = await call(HUNTER, { action: 'claim', battleId: 'bounty-180-credit-fails-a1' });
        assert.equal(retry.statusCode, 200, JSON.stringify(retry.body));
        assert.equal(retry.body?.amount, 2_000);
        const replay = await call(HUNTER, { action: 'claim', battleId: 'bounty-180-credit-fails-a1' });
        assert.equal(replay.body?.alreadyClaimed, true);
        assert.equal(await ryo(HUNTER), 2_100, 'paid exactly once');
        assert.equal(await ryo(RIVAL), 100);
        assert.equal((await board()).pendingClaims, undefined, 'the finished claim left the board');
    });

    test('a failed reservation pays nobody and leaves the pool claimable', async (t) => {
        assert.equal((await postBounty(2_000)).statusCode, 200);
        await seedWin('bounty-180-reserve-fails-1', 'Retry Hunter');
        const original = kv.set.bind(kv);
        let broken = true;
        t.mock.method(kv, 'set', async (...args: Parameters<typeof kv.set>) => {
            if (broken && args[0] === BOARD_KEY) throw new Error('injected reservation failure');
            return original(...args);
        });
        const failed = await call(HUNTER, { action: 'claim', battleId: 'bounty-180-reserve-fails-1' });
        assert.equal(failed.statusCode, 500, JSON.stringify(failed.body));
        assert.equal(await ryo(HUNTER), 100);
        assert.equal(await pool(), 2_000, 'still posted');
        broken = false;
        const retry = await call(HUNTER, { action: 'claim', battleId: 'bounty-180-reserve-fails-1' });
        assert.equal(retry.body?.amount, 2_000);
        assert.equal(await ryo(HUNTER), 2_100);
    });

    test('an interrupted payout is finished once by the sweep of a later claim', async (t) => {
        assert.equal((await postBounty(2_000)).statusCode, 200);
        await seedWin('bounty-180-sweep-a-0000001', 'Retry Hunter');
        await seedWin('bounty-180-sweep-b-0000001', 'Retry Rival');
        const original = kv.compareSet.bind(kv);
        let broken = true;
        t.mock.method(kv, 'compareSet', async (...args: Parameters<typeof kv.compareSet>) => {
            if (broken && args[0] === `save:${HUNTER}`) throw new Error('process stopped');
            return original(...args);
        });
        assert.notEqual((await call(HUNTER, { action: 'claim', battleId: 'bounty-180-sweep-a-0000001' })).statusCode, 200);
        broken = false;
        t.mock.restoreAll();

        // The hunter never comes back. Another claim, later, finds the entry.
        const realNow = Date.now;
        Date.now = () => realNow() + sweepAfterMs + 1_000;
        try {
            const rival = await call(RIVAL, { action: 'claim', battleId: 'bounty-180-sweep-b-0000001' });
            assert.equal(rival.statusCode, 200, JSON.stringify(rival.body));
            assert.equal(rival.body?.amount, 0);
        } finally {
            Date.now = realNow;
        }
        assert.equal(await ryo(HUNTER), 2_100, 'the sweep paid the reserved winner');
        assert.equal((await board()).pendingClaims, undefined);
        const receipt = await call(HUNTER, { action: 'claim', battleId: 'bounty-180-sweep-a-0000001' });
        assert.equal(receipt.body?.alreadyClaimed, true, 'the sweep also wrote the battle record');
        assert.equal(receipt.body?.amount, 2_000);
        assert.equal(await ryo(HUNTER), 2_100, 'and nobody is paid twice');
    });

    test('a winner whose save is gone puts the pool back', async () => {
        assert.equal((await postBounty(2_000)).statusCode, 200);
        await seedWin('bounty-180-missing-save-01', 'Retry Hunter');
        await kv.del(`save:${HUNTER}`);
        const out = await call(HUNTER, { action: 'claim', battleId: 'bounty-180-missing-save-01' });
        assert.equal(out.statusCode, 404, JSON.stringify(out.body));
        assert.equal(await pool(), 2_000, 'the pool is posted again for a real hunter');
        assert.equal((await board()).pendingClaims, undefined);
    });
});

describe('sleeping-camp KO payout is two-phase (#180)', () => {
    const settle = () => settleSleeper({ attackerSlug: HUNTER, victimSlug: TARGET, victimName: 'Retry Target', rewardEligible: true });

    test('a failed credit stays reserved and the next sweep pays it once', async (t) => {
        assert.equal((await postBounty(2_000)).statusCode, 200);
        const original = kv.compareSet.bind(kv);
        let broken = true;
        t.mock.method(kv, 'compareSet', async (...args: Parameters<typeof kv.compareSet>) => {
            if (broken && args[0] === `save:${HUNTER}`) throw new Error('process stopped');
            return original(...args);
        });
        assert.deepEqual(await settle(), { amount: 0, saveVersion: null }, 'never throws into the committed KO');
        assert.equal(await pool(), 0, 'the pool is reserved, not re-posted');
        broken = false;
        t.mock.restoreAll();
        const realNow = Date.now;
        Date.now = () => realNow() + sweepAfterMs + 1_000;
        try {
            assert.equal((await settle()).amount, 0, 'no bounty is left for a second KO');
        } finally {
            Date.now = realNow;
        }
        assert.equal(await ryo(HUNTER), 2_100, 'paid exactly once by the sweep');
        assert.equal((await board()).pendingClaims, undefined);
    });

    test('a board write that fails after the payout never lets the pool pay twice', async (t) => {
        assert.equal((await postBounty(2_000)).statusCode, 200);
        // Same window as the duel test: any board write after the credit fails.
        const original = kv.set.bind(kv);
        const originalGet = kv.get.bind(kv);
        t.mock.method(kv, 'set', async (...args: Parameters<typeof kv.set>) => {
            if (args[0] === BOARD_KEY) {
                const hunter = await originalGet<{ character: { ryo: number } }>(`save:${HUNTER}`);
                if (Number(hunter?.character.ryo) > 100) throw new Error('injected board write failure after payout');
            }
            return original(...args);
        });
        await settle();
        t.mock.restoreAll();
        assert.equal(await ryo(HUNTER), 2_100, 'the attacker was paid');
        assert.equal(await pool(), 0, 'the pool is not posted for a second collection');
        assert.equal((await board()).pendingClaims?.length, 1, 'the clean-up is still owed');
        const realNow = Date.now;
        Date.now = () => realNow() + sweepAfterMs + 1_000;
        try {
            await settle();
        } finally {
            Date.now = realNow;
        }
        assert.equal(await ryo(HUNTER), 2_100, 'the sweep found the receipt and paid nothing more');
        assert.equal((await board()).pendingClaims, undefined);
    });
});
