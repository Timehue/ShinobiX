import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'clan-donate-retry-test-secret-32-bytes!';
process.env.ADMIN_PASSWORD = 'clan-donate-retry-test-admin-password';

/*
 * /api/clan/treasury/donate through the real handler and storage adapter
 * (issue #179). The same request id never debits the donor twice or credits
 * the treasury (or clan XP) twice; a donation whose clan-row write failed is
 * finished by the donor's retry or by admin reconciliation, never unwound.
 */

type Handler = (req: never, res: never) => Promise<unknown>;
type Out = { statusCode: number; body?: Record<string, unknown> };

const DONOR = 'clandonor';
const OUTSIDER = 'clanoutsider';
const CLAN_KEY = 'save:clan-mist';

let kv: typeof import('../../_storage.js').kv;
let issuePlayerToken: (name: string) => string | null;
let resetRateLimits: () => void;
let donate: Handler;
let reconcile: Handler;
let economyTxKey: typeof import('../../_economy-tx.js').economyTxKey;
let readEconomyTxSnapshot: typeof import('../../_economy-tx.js').readEconomyTxSnapshot;
let saveDebitTransactionId: typeof import('../../_save-debit-saga.js').saveDebitTransactionId;
let expectedAfter1000Xp: { xp: number; level: number };

before(async () => {
    // 35,000 ryo / 35 = 1,000 clan XP, levelled exactly as the handler does.
    expectedAfter1000Xp = (await import('../_mission-catalog.js')).addClanXpServer(0, 1, 1_000);
    ({ kv } = await import('../../_storage.js'));
    ({ issuePlayerToken } = await import('../../_auth.js'));
    ({ __resetRateLimitsForTest: resetRateLimits } = await import('../../_ratelimit.js'));
    ({ economyTxKey, readEconomyTxSnapshot } = await import('../../_economy-tx.js'));
    ({ saveDebitTransactionId } = await import('../../_save-debit-saga.js'));
    donate = (await import('./donate.js')).default as unknown as Handler;
    reconcile = (await import('../../admin/economy-reconcile.js')).default as unknown as Handler;
});

beforeEach(async () => {
    resetRateLimits();
    const keys = await kv.keys('*');
    if (keys.length) await kv.del(...keys);
    await kv.set(CLAN_KEY, { name: 'Mist', founderName: DONOR, treasury: { ryo: 0, items: [] }, xp: 0, level: 1 });
    await kv.set(`save:${DONOR}`, {
        _saveVersion: 1,
        character: { name: DONOR, clan: 'Mist', level: 40, ryo: 100_000, inventory: [], itemStacks: [{ itemId: 'item-smoke-bomb', count: 5 }] },
    });
    await kv.set(`save:${OUTSIDER}`, { _saveVersion: 1, character: { name: OUTSIDER, clan: 'Other', level: 40, ryo: 100_000 } });
});

after(async () => {
    const keys = await kv.keys('*');
    if (keys.length) await kv.del(...keys);
    for (const key of ['SHINOBIX_QA_MEMORY_KV', 'SESSION_SECRET', 'ADMIN_PASSWORD']) delete process.env[key];
});

function responder() {
    const out: Out = { statusCode: 200 };
    const res = {
        setHeader: () => res,
        status: (statusCode: number) => { out.statusCode = statusCode; return res; },
        json: (payload: Record<string, unknown>) => { out.body = payload; return res; },
        end: () => res,
    };
    return { out, res: res as never };
}

async function call(body: Record<string, unknown>, as = DONOR): Promise<Out> {
    const { out, res } = responder();
    await donate({
        method: 'POST',
        body: { playerName: DONOR, clan: 'Mist', ...body },
        headers: { 'x-player-name': as, 'x-player-token': issuePlayerToken(as) ?? '' },
        socket: { remoteAddress: '127.0.3.1' },
    } as never, res);
    return out;
}

async function adminReconcile(body: Record<string, unknown>): Promise<Out> {
    const { out, res } = responder();
    await reconcile({
        method: 'POST',
        body,
        headers: { 'x-admin-password': process.env.ADMIN_PASSWORD! },
        socket: { remoteAddress: '127.0.3.2' },
    } as never, res);
    return out;
}

const donor = async () => (await kv.get<{ character: Record<string, unknown> }>(`save:${DONOR}`))!.character;
const clan = async () => (await kv.get<{ treasury: Record<string, unknown>; xp: number; level: number }>(CLAN_KEY))!;

test('a currency donation debits once, credits the treasury and clan XP once, and its retry replays', async () => {
    const first = await call({ currency: 'ryo', amount: 35_000, requestId: 'clan-donate-replay-0001' });
    assert.equal(first.statusCode, 200, JSON.stringify(first.body));
    assert.equal((first.body?.treasury as { ryo: number }).ryo, 35_000);
    assert.deepEqual({ xp: first.body?.xp, level: first.body?.level }, expectedAfter1000Xp);
    assert.ok(expectedAfter1000Xp.level > 1, 'the grant is large enough that a second one would show');
    const retry = await call({ currency: 'ryo', amount: 35_000, requestId: 'clan-donate-replay-0001' });
    assert.equal(retry.statusCode, 200, JSON.stringify(retry.body));
    assert.equal(retry.body?.replayed, true);
    assert.equal((await donor()).ryo, 65_000, 'one debit');
    assert.equal((await clan()).treasury.ryo, 35_000, 'one credit');
    assert.deepEqual({ xp: (await clan()).xp, level: (await clan()).level }, expectedAfter1000Xp, 'clan XP granted once');
    assert.equal((await donor()).clanEventContrib, 35, 'monthly contribution counted once');
});

test('an item donation removes the items once and stocks the treasury once', async () => {
    const body = { itemId: 'item-smoke-bomb', count: 3, requestId: 'clan-donate-items-00001' };
    assert.equal((await call(body)).statusCode, 200);
    assert.equal((await call(body)).body?.replayed, true);
    assert.deepEqual((await donor()).itemStacks, [{ itemId: 'item-smoke-bomb', count: 2 }]);
    assert.deepEqual((await clan()).treasury.items, [{ itemId: 'item-smoke-bomb', count: 3 }]);
});

test('concurrent duplicates donate once', async () => {
    const outs = await Promise.all(Array.from({ length: 5 }, () => call({ currency: 'ryo', amount: 7_000, requestId: 'clan-donate-dupes-00001' })));
    for (const out of outs) assert.ok(out.statusCode === 200 || out.statusCode === 503, JSON.stringify(out));
    assert.equal((await donor()).ryo, 93_000);
    assert.equal((await clan()).treasury.ryo, 7_000);
});

test('a failed clan-row write keeps the debit, lists the donation as stuck, and the retry finishes it once', async (t) => {
    const original = kv.set.bind(kv);
    let broken = true;
    t.mock.method(kv, 'set', async (...args: Parameters<typeof kv.set>) => {
        if (broken && args[0] === CLAN_KEY) throw new Error('injected clan-row write failure');
        return original(...args);
    });
    const failed = await call({ currency: 'ryo', amount: 35_000, requestId: 'clan-donate-stuck-00001' });
    assert.equal(failed.statusCode, 503, JSON.stringify(failed.body));
    assert.equal(failed.body?.pending, true);
    assert.equal((await donor()).ryo, 65_000, 'a donation is finished, not unwound');
    assert.equal((await clan()).treasury.ryo, 0);
    const txId = saveDebitTransactionId('clan-treasury-donate', DONOR, 'clan-donate-stuck-00001');
    assert.ok((await readEconomyTxSnapshot(50)).stuck.some((tx) => tx.id === txId), 'visible in /api/admin/economy');

    broken = false;
    const retry = await call({ currency: 'ryo', amount: 35_000, requestId: 'clan-donate-stuck-00001' });
    assert.equal(retry.statusCode, 200, JSON.stringify(retry.body));
    assert.equal((await donor()).ryo, 65_000, 'no second debit');
    assert.equal((await clan()).treasury.ryo, 35_000, 'the credit landed once');
    assert.deepEqual({ xp: (await clan()).xp, level: (await clan()).level }, expectedAfter1000Xp, 'clan XP once');
    assert.equal((await kv.get<{ state: string }>(economyTxKey(txId)))?.state, 'complete');
});

test('admin reconciliation finishes a stuck donation the donor never retried', async (t) => {
    const original = kv.set.bind(kv);
    let broken = true;
    t.mock.method(kv, 'set', async (...args: Parameters<typeof kv.set>) => {
        if (broken && args[0] === CLAN_KEY) throw new Error('injected clan-row write failure');
        return original(...args);
    });
    assert.equal((await call({ currency: 'ryo', amount: 14_000, requestId: 'clan-donate-admin-00001' })).statusCode, 503);
    broken = false;
    const txId = saveDebitTransactionId('clan-treasury-donate', DONOR, 'clan-donate-admin-00001');
    const fixed = await adminReconcile({ txId });
    assert.equal(fixed.statusCode, 200, JSON.stringify(fixed.body));
    assert.equal(fixed.body?.status, 'completed');
    assert.equal((await clan()).treasury.ryo, 14_000);
    const again = await adminReconcile({ txId });
    assert.equal(again.body?.status, 'already-complete');
    assert.equal((await clan()).treasury.ryo, 14_000, 'reconciling twice credits once');
    // The donor's late retry is a plain replay.
    assert.equal((await call({ currency: 'ryo', amount: 14_000, requestId: 'clan-donate-admin-00001' })).body?.replayed, true);
    assert.equal((await donor()).ryo, 86_000);
    assert.equal((await clan()).treasury.ryo, 14_000);
});

test('non-members, forged identities, reused ids and short balances move nothing', async () => {
    const outsider = await call({ playerName: OUTSIDER, currency: 'ryo', amount: 1_000, requestId: 'clan-donate-outsider-01' }, OUTSIDER);
    assert.equal(outsider.statusCode, 403, JSON.stringify(outsider.body));
    const forged = await call({ currency: 'ryo', amount: 1_000, requestId: 'clan-donate-forged-0001' }, OUTSIDER);
    assert.ok(forged.statusCode === 401 || forged.statusCode === 403, JSON.stringify(forged));
    const poor = await call({ currency: 'ryo', amount: 150_000, requestId: 'clan-donate-too-poor-01' });
    assert.equal(poor.statusCode, 400);
    assert.equal((await call({ currency: 'ryo', amount: 1_000, requestId: 'clan-donate-reused-0001' })).statusCode, 200);
    const reused = await call({ currency: 'ryo', amount: 2_000, requestId: 'clan-donate-reused-0001' });
    assert.equal(reused.statusCode, 409);
    assert.equal((await donor()).ryo, 99_000);
    assert.equal((await clan()).treasury.ryo, 1_000);
    assert.equal((await kv.get<{ character: { ryo: number } }>(`save:${OUTSIDER}`))?.character.ryo, 100_000);
});
