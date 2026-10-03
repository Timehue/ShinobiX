process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'trade-settlement-test-secret-32-bytes';
process.env.ADMIN_PASSWORD = 'trade-settlement-test-admin';

import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';

/*
 * The two doors besides the player's own retry that finish an interrupted
 * trade (api/player/_trade-settlement.ts): the admin reconcile, reached
 * through POST /api/admin/economy-reconcile, and the recovery sweep. Each
 * stuck state is made by driving the real trade handler into it, then the
 * door is opened. The retry door is covered in trade.test.ts.
 */

type Json = Record<string, unknown>;
type Handler = (req: never, res: never) => Promise<unknown>;

let kv: typeof import('../_storage.js').kv;
let issuePlayerToken: typeof import('../_auth.js').issuePlayerToken;
let resetRateLimits: typeof import('../_ratelimit.js').__resetRateLimitsForTest;
let readEconomyTxSnapshot: typeof import('../_economy-tx.js').readEconomyTxSnapshot;
let settlement: typeof import('./_trade-settlement.js');
let tradeHandler: Handler;
let reconcileHandler: Handler;
let PET_BREEDING_MIGRATION_VERSION: number;

const SENDER = 'settlesender';
const RECIPIENT = 'settlerecipient';
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

async function trade(nonce: string) {
    const token = issuePlayerToken(SENDER);
    const ip = `10.41.0.${++ipSeed}`;
    const { out, res } = response();
    await tradeHandler({
        method: 'POST',
        body: { playerName: SENDER, toPlayer: RECIPIENT, currency: 'ryo', amount: 5_000, nonce },
        query: {},
        headers: { 'content-type': 'application/json', 'x-player-name': SENDER, 'x-player-token': token, 'x-forwarded-for': ip },
        socket: { remoteAddress: ip },
    } as never, res);
    return out;
}

async function adminReconcile(txId: string) {
    const { out, res } = response();
    await reconcileHandler({
        method: 'POST',
        body: { txId },
        query: {},
        headers: { 'content-type': 'application/json', 'x-admin-password': process.env.ADMIN_PASSWORD! },
        socket: { remoteAddress: '10.41.1.1' },
    } as never, res);
    return out;
}

async function balances() {
    const sender = (await kv.get<Json>(`save:${SENDER}`))?.character as Json;
    const recipient = (await kv.get<Json>(`save:${RECIPIENT}`))?.character as Json;
    return { sender: Number(sender.ryo), recipient: Number(recipient.ryo) };
}

async function journals(): Promise<Json[]> {
    return (await Promise.all((await kv.keys('economy-tx:player-trade:*')).map((key) => kv.get<Json>(key)))) as Json[];
}

async function journal(): Promise<Json> {
    const records = await journals();
    assert.equal(records.length, 1, `one trade journal record: ${JSON.stringify(records.map((r) => r.id))}`);
    return records[0]!;
}

async function budgetCharged(): Promise<number> {
    const ledger = await kv.get<{ stamps?: [number, number][] }>(`xfer:out:${SENDER}:ryo`);
    return (ledger?.stamps ?? []).reduce((sum, [, amount]) => sum + amount, 0);
}

async function burnsRecorded(): Promise<number> {
    return ((await kv.get<Json[]>('econ:txns')) ?? []).filter((txn) => txn.source === 'trade.burn').length;
}

/** Answer every compare-and-set of `save:<slug>` with `write` while `run` executes. */
async function withSaveWrite<T>(
    slug: string,
    write: (original: () => Promise<boolean>) => Promise<boolean>,
    run: () => Promise<T>,
): Promise<T> {
    const originalCompareSet = kv.compareSet;
    kv.compareSet = (key, expected, value, options) => key === `save:${slug}`
        ? write(() => originalCompareSet.call(kv, key, expected, value, options))
        : originalCompareSet.call(kv, key, expected, value, options);
    try {
        return await run();
    } finally {
        kv.compareSet = originalCompareSet;
    }
}

/** A trade whose debit landed and whose credit failed: the sender paid, the recipient has nothing yet. */
async function debitedTrade(nonce: string): Promise<string> {
    const out = await withSaveWrite(RECIPIENT, async () => false, () => trade(nonce));
    assert.equal(out.statusCode, 502, JSON.stringify(out.body));
    assert.deepEqual(await balances(), { sender: 45_000, recipient: 0 });
    return String(out.body?.txId);
}

/**
 * A trade whose debit write failed without landing while every read of the
 * sender's save failed too, so nobody could tell it missed: nothing moved, and
 * the nonce stays pending.
 */
async function unconfirmedMissedTrade(nonce: string): Promise<string> {
    const originalCompareSet = kv.compareSet;
    const originalGet = kv.get;
    let failed = false;
    kv.compareSet = async (key, expected, value, options) => {
        if (!failed && key === `save:${SENDER}`) { failed = true; throw new Error('write-down'); }
        return originalCompareSet.call(kv, key, expected, value, options);
    };
    (kv as { get: unknown }).get = async (key: string) => {
        if (failed && key === `save:${SENDER}`) throw new Error('read-back-down');
        return (originalGet as (k: string) => Promise<unknown>).call(kv, key);
    };
    let out;
    try {
        out = await trade(nonce);
    } finally {
        kv.compareSet = originalCompareSet;
        (kv as { get: unknown }).get = originalGet;
    }
    assert.equal(out.statusCode, 502, JSON.stringify(out.body));
    assert.equal(out.body?.pending, true);
    assert.deepEqual(await balances(), { sender: 50_000, recipient: 0 });
    return String(out.body?.txId);
}

/** Fill the sender's receipt list with newer settlements, as if the trade's own receipt had aged out. */
async function crowdSenderReceipts(): Promise<void> {
    const stored = (await kv.get<Json>(`save:${SENDER}`))!;
    const now = Date.now();
    const crowded = Array.from({ length: 50 }, (_, i) => ({
        requestId: `later-settlement-${String(i).padStart(4, '0')}`, fingerprint: 'f'.repeat(64), value: { i }, settledAt: now - i,
    }));
    await kv.set(`save:${SENDER}`, { ...stored, _saveVersion: Number(stored._saveVersion) + 1, character: { ...(stored.character as Json), serverSettlementReceipts: crowded } });
}

/** Drop the journal's stamps: only the receipts in the saves can say what moved. */
async function unstamp(txId: string): Promise<void> {
    const record = (await kv.get<Json>(`economy-tx:${txId}`))!;
    const { debitAppliedAt: _debited, creditAppliedAt: _credited, ...meta } = record.meta as Json;
    await kv.set(`economy-tx:${txId}`, { ...record, meta });
}

/** A sweep run late enough that every unfinished trade is idle. */
function sweepLater() {
    return settlement.recoverPendingPlayerTrades({ now: Date.now() + settlement.TRADE_RECOVERY_IDLE_MS + 1_000 });
}

before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ issuePlayerToken } = await import('../_auth.js'));
    ({ __resetRateLimitsForTest: resetRateLimits } = await import('../_ratelimit.js'));
    ({ readEconomyTxSnapshot } = await import('../_economy-tx.js'));
    ({ PET_BREEDING_MIGRATION_VERSION } = await import('../pet/_owned-pet.js'));
    settlement = await import('./_trade-settlement.js');
    tradeHandler = (await import('./trade.js')).default as unknown as Handler;
    reconcileHandler = (await import('../admin/economy-reconcile.js')).default as unknown as Handler;
});

beforeEach(async () => {
    for (const key of await kv.keys('*')) await kv.del(key);
    resetRateLimits();
    await kv.set(`save:${SENDER}`, { _saveVersion: 1, character: { name: SENDER, level: 20, ryo: 50_000, petBreedingMigrationVersion: PET_BREEDING_MIGRATION_VERSION } });
    await kv.set(`save:${RECIPIENT}`, { _saveVersion: 1, character: { name: RECIPIENT, level: 20, ryo: 0, petBreedingMigrationVersion: PET_BREEDING_MIGRATION_VERSION } });
});

after(async () => {
    for (const key of await kv.keys('*')) await kv.del(key);
    delete process.env.SHINOBIX_QA_MEMORY_KV;
    delete process.env.SESSION_SECRET;
    delete process.env.ADMIN_PASSWORD;
});

describe('releasing a trade nonce', { concurrency: false }, () => {
    it('frees only a pending marker that names the trade being released', async () => {
        const key = `trade:nonce:${SENDER}:release-0001`;
        await kv.set(key, { ts: 1, txId: 'player-trade:newer', pending: true, fp: 'f' });
        await settlement.releaseTradeNonce(key, 'player-trade:older');
        assert.equal((await kv.get<Json>(key))?.txId, 'player-trade:newer', "a newer attempt's marker is kept");

        await kv.set(key, { ts: 1, receipt: { ok: true }, fp: 'f' });
        await settlement.releaseTradeNonce(key, 'player-trade:older');
        assert.ok((await kv.get<Json>(key))?.receipt, 'a final receipt is kept');

        await kv.set(key, { ts: 1, txId: 'player-trade:older', pending: true, fp: 'f' });
        await settlement.releaseTradeNonce(key, 'player-trade:older');
        assert.equal(await kv.get(key), null, "the trade's own marker is freed");

        await settlement.releaseTradeNonce(key, 'player-trade:older');
        await settlement.releaseTradeNonce('', 'player-trade:older');
        assert.equal(await kv.get(key), null, 'releasing nothing is a no-op');
    });
});

describe('admin reconcile of a player trade', { concurrency: false }, () => {
    it('rolls the credit of a debited trade forward exactly once', async () => {
        const txId = await debitedTrade('reconcile-0001');
        assert.equal(await budgetCharged(), 5_000);

        const out = await adminReconcile(txId);
        assert.equal(out.statusCode, 200, JSON.stringify(out.body));
        assert.equal(out.body?.status, 'credited');
        assert.equal(out.body?.credited, 4_500, 'the admin view shows what reached the recipient');
        assert.equal((out.body?.tx as Json)?.state, 'complete');
        assert.deepEqual(await balances(), { sender: 45_000, recipient: 4_500 });
        assert.equal(await burnsRecorded(), 1);
        assert.equal(await budgetCharged(), 5_000, 'the reconcile charges no budget');
        assert.deepEqual(await kv.keys('trade:pending:*'), []);

        const again = await adminReconcile(txId);
        assert.equal(again.statusCode, 200, JSON.stringify(again.body));
        assert.equal(again.body?.status, 'already-complete');
        assert.deepEqual(await balances(), { sender: 45_000, recipient: 4_500 }, 'a second click moves nothing');
        assert.equal(await burnsRecorded(), 1);

        const retry = await trade('reconcile-0001');
        assert.equal(retry.statusCode, 200, JSON.stringify(retry.body));
        assert.equal(retry.body?.duplicate, true, "the player's retry replays the finished trade");
        assert.deepEqual(await balances(), { sender: 45_000, recipient: 4_500 });
    });

    it('cancels a trade whose debit never landed, and frees its nonce for a real retry', async () => {
        const txId = await unconfirmedMissedTrade('reconcile-0002');
        const out = await adminReconcile(txId);
        assert.equal(out.statusCode, 200, JSON.stringify(out.body));
        assert.equal(out.body?.status, 'no-debit');
        assert.equal((out.body?.tx as Json)?.state, 'refunded');
        assert.deepEqual(await balances(), { sender: 50_000, recipient: 0 }, 'nothing moved');
        assert.equal(await kv.get(`trade:nonce:${SENDER}:reconcile-0002`), null, 'the nonce is free');
        assert.deepEqual(await kv.keys('trade:pending:*'), []);

        const retry = await trade('reconcile-0002');
        assert.equal(retry.statusCode, 200, JSON.stringify(retry.body));
        assert.notEqual(retry.body?.duplicate, true, 'the retry runs as a new transfer');
        assert.deepEqual(await balances(), { sender: 45_000, recipient: 4_500 });
        assert.deepEqual((await journals()).map((record) => record.state).sort(), ['complete', 'refunded']);
    });

    it("never frees a nonce that a newer attempt of it has claimed", async () => {
        // The first attempt loses its compare-and-set and releases the nonce;
        // the second claims it, debits, and fails its credit.
        let lose = true;
        const out = await withSaveWrite(SENDER, async (write) => {
            if (!lose) return write();
            lose = false;
            return false;
        }, () => withSaveWrite(RECIPIENT, async () => false, () => trade('reconcile-0003')));
        assert.equal(out.statusCode, 502, JSON.stringify(out.body));
        const newer = String(out.body?.txId);
        const older = (await journals()).find((record) => record.id !== newer)!;
        assert.match(String(older.note), /no funds moved/);

        const cancelled = await adminReconcile(String(older.id));
        assert.equal(cancelled.body?.status, 'no-debit', JSON.stringify(cancelled.body));
        const marker = await kv.get<Json>(`trade:nonce:${SENDER}:reconcile-0003`);
        assert.equal(marker?.txId, newer, "the newer attempt's marker survives");

        // Deleting it would have let this retry debit the sender a second time.
        await kv.set(`trade:nonce:${SENDER}:reconcile-0003`, { ...marker, ts: Date.now() - 60_000 });
        const retry = await trade('reconcile-0003');
        assert.equal(retry.statusCode, 200, JSON.stringify(retry.body));
        assert.deepEqual(await balances(), { sender: 45_000, recipient: 4_500 }, 'one debit, one credit');
    });

    it('closes the books of a trade whose two writes both landed', async () => {
        const first = await trade('reconcile-0004');
        assert.equal(first.statusCode, 200);
        const record = await journal();
        const { completedAt: _completedAt, ...open } = record;
        await kv.set(`economy-tx:${record.id}`, { ...open, state: 'credit-applied' });
        await unstamp(String(record.id));
        await kv.del('econ:txns');

        const out = await adminReconcile(String(record.id));
        assert.equal(out.statusCode, 200, JSON.stringify(out.body));
        assert.equal(out.body?.status, 'completed');
        assert.deepEqual(await balances(), { sender: 45_000, recipient: 4_500 }, 'nothing moved again');
        assert.equal(await burnsRecorded(), 1, 'recorded once, by the call that completed it');
    });

    it('refuses what the receipts cannot prove, and flags it for a human', async () => {
        const txId = await debitedTrade('reconcile-0005');
        await unstamp(txId);
        await crowdSenderReceipts();

        const out = await adminReconcile(txId);
        assert.equal(out.statusCode, 409, JSON.stringify(out.body));
        assert.match(String(out.body?.error), /aged out/);
        assert.deepEqual(await balances(), { sender: 45_000, recipient: 0 }, 'nothing is credited on a guess');
        const record = await journal();
        assert.equal(record.state, 'needs-reconcile');
        assert.equal(record.error, 'trade-unprovable');
    });

    it('refuses a journal from before trade receipts', async () => {
        const txId = await debitedTrade('reconcile-0006');
        const record = (await kv.get<Json>(`economy-tx:${txId}`))!;
        const { receiptBacked: _receiptBacked, ...legacy } = record.meta as Json;
        await kv.set(`economy-tx:${txId}`, { ...record, meta: legacy });

        const out = await adminReconcile(txId);
        assert.equal(out.statusCode, 409, JSON.stringify(out.body));
        assert.match(String(out.body?.error), /predates trade receipts/);
        assert.deepEqual(await balances(), { sender: 45_000, recipient: 0 });
    });
});

describe('player trade recovery sweep', { concurrency: false }, () => {
    it('finishes a debited trade nobody retried, and leaves a live one alone', async () => {
        const txId = await debitedTrade('sweep-0001');

        const early = await settlement.recoverPendingPlayerTrades();
        assert.equal(early.waiting, 1, 'a trade touched moments ago may still be running');
        assert.deepEqual(early.finished, []);
        assert.deepEqual(await balances(), { sender: 45_000, recipient: 0 });

        const later = await sweepLater();
        assert.deepEqual(later.finished, [{ txId, status: 'credited' }]);
        assert.deepEqual(await balances(), { sender: 45_000, recipient: 4_500 }, 'the recipient is paid without anyone retrying');
        assert.equal((await journal()).state, 'complete');
        assert.equal(await burnsRecorded(), 1);
        assert.equal(await budgetCharged(), 5_000);
        assert.deepEqual(await kv.keys('trade:pending:*'), []);

        const idle = await sweepLater();
        assert.deepEqual(idle.finished, [], 'nothing is left to finish');
        assert.equal((await trade('sweep-0001')).body?.duplicate, true, "the sender's retry replays it");
    });

    it('closes the journal an attempt that moved nothing left behind, clearing the admin view', async () => {
        let lose = true;
        const out = await withSaveWrite(SENDER, async (write) => {
            if (!lose) return write();
            lose = false;
            return false;
        }, () => trade('sweep-0002'));
        assert.equal(out.statusCode, 200, JSON.stringify(out.body));
        assert.equal((await readEconomyTxSnapshot()).stuck.length, 1, 'the losing attempt is left journalled');

        const swept = await sweepLater();
        assert.equal(swept.finished.length, 1, JSON.stringify(swept));
        assert.equal(swept.finished[0]!.status, 'no-debit');
        assert.deepEqual((await journals()).map((record) => record.state).sort(), ['complete', 'refunded']);
        assert.deepEqual((await readEconomyTxSnapshot()).stuck, [], 'nothing is left for an admin');
        assert.deepEqual(await balances(), { sender: 45_000, recipient: 4_500 }, 'the trade that ran is untouched');
    });

    it('holds an unprovable trade for review once, and stops retrying it', async () => {
        const txId = await debitedTrade('sweep-0003');
        await unstamp(txId);
        await crowdSenderReceipts();

        const first = await sweepLater();
        assert.equal(first.heldForReview.length, 1, JSON.stringify(first));
        assert.equal(first.heldForReview[0]!.txId, txId);
        assert.equal((await journal()).state, 'needs-reconcile', 'the admin economy view shows it');
        assert.deepEqual(await balances(), { sender: 45_000, recipient: 0 });

        const second = await sweepLater();
        assert.equal(second.heldForReview.length + second.finished.length + second.failures.length, 0, 'it is not retried');
    });

    it('clears a pointer whose journal never got written, once it is idle', async () => {
        await kv.set(settlement.tradePendingKey('player-trade:deadbeefdeadbeef'), { txId: 'player-trade:deadbeefdeadbeef', at: Date.now() - 10 * 60_000 });
        await kv.set(settlement.tradePendingKey('player-trade:cafecafecafecafe'), { txId: 'player-trade:cafecafecafecafe', at: Date.now() });

        const out = await settlement.recoverPendingPlayerTrades();
        assert.equal(out.waiting, 1, 'a pointer this new may belong to an attempt about to journal');
        assert.deepEqual(await kv.keys('trade:pending:*'), [settlement.tradePendingKey('player-trade:cafecafecafecafe')]);
    });

    it('stops at its budget and reports that more is waiting', async () => {
        await debitedTrade('sweep-0005');
        // Top the sender back up so a second trade can be debited and stranded too.
        const stored = (await kv.get<Json>(`save:${SENDER}`))!;
        await kv.set(`save:${SENDER}`, { ...stored, character: { ...(stored.character as Json), ryo: 50_000 } });
        await debitedTrade('sweep-0006');

        const out = await settlement.recoverPendingPlayerTrades({ now: Date.now() + settlement.TRADE_RECOVERY_IDLE_MS + 1_000, limit: 1 });
        assert.equal(out.finished.length, 1, JSON.stringify(out));
        assert.equal(out.truncated, true);
        assert.equal((await sweepLater()).finished.length, 1, 'the next pass takes the rest');
        assert.equal((await balances()).recipient, 9_000, 'both stranded credits landed, once each');
    });
});
