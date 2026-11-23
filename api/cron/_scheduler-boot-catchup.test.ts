process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
import { after, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { kv } from '../_storage.js';
import { SNAPSHOT_SUCCESS_KEY, type SnapshotSuccessMarker } from './snapshot-saves.js';
import { fireSettlementReconciliation, logTickFailure, runBootSnapshotCatchUpCore, stopSnapshotCron } from './_scheduler.js';
import {
    beginDurableSettlement, DURABLE_SETTLEMENT_PENDING_PREFIX, durableSettlementKey, getDurableSettlement, settlementTransactionId,
} from '../_durable-settlement.js';

// The boot catch-up reads the backup-freshness marker first. On 2026-11-23 a
// deploy's container swap refused that one read (EMAXCONNSESSION), and the
// scheduler treated "unknown" as "stale": it ran a full snapshot pass of every
// save against the already-full pool, 22 h after the nightly backup.

const POOL_FULL = () => Object.assign(
    new Error('(EMAXCONNSESSION) max clients reached in session mode - max clients are limited to pool_size: 25'),
    { code: 'EMAXCONNSESSION' },
);

beforeEach(async () => { for (const key of await kv.keys('*')) await kv.del(key); });
after(() => stopSnapshotCron());

function capture(t: import('node:test').TestContext) {
    const lines: string[] = [];
    for (const level of ['log', 'warn', 'error'] as const) {
        t.mock.method(console, level, (...args: unknown[]) => { lines.push(`${level} ${args.map(String).join(' ')}`); });
    }
    return lines;
}

function failMarkerRead(t: import('node:test').TestContext, error: () => Error) {
    const get = kv.get.bind(kv);
    t.mock.method(kv, 'get', async (...args: Parameters<typeof kv.get>) => {
        if (args[0] === SNAPSHOT_SUCCESS_KEY) throw error();
        return get(...args);
    });
}

test('a pool-full refusal of the marker read defers the check instead of running a full snapshot pass', async (t) => {
    const lines = capture(t);
    failMarkerRead(t, POOL_FULL);
    const keys = t.mock.method(kv, 'keys');
    await runBootSnapshotCatchUpCore();
    assert.ok(lines.some((line) => line.startsWith('warn') && line.includes('backup marker read deferred')), lines.join('\n'));
    assert.ok(!lines.some((line) => line.includes('boot catch-up:')), 'no snapshot pass ran');
    assert.ok(!lines.some((line) => line.startsWith('error')), 'a transient refusal is not logged as an error');
    assert.equal(keys.mock.callCount(), 0, 'the save keyspace was never scanned');
    assert.equal(await kv.get('cron:lease:snapshot'), null, 'the nightly snapshot lease was not taken');
});

test('a permanent marker-read failure still runs the catch-up, as before', async (t) => {
    const lines = capture(t);
    failMarkerRead(t, () => Object.assign(new Error('password authentication failed for user'), { code: '28P01' }));
    await runBootSnapshotCatchUpCore();
    assert.ok(lines.some((line) => line.startsWith('error') && line.includes('attempting boot catch-up')), lines.join('\n'));
    assert.ok(lines.some((line) => line.includes('boot catch-up:') || line.includes('snapshot recovery deferred')), 'the catch-up was attempted');
});

test('a recurring job logs a deploy-time refusal as deferred, and anything else as the usual error', (t) => {
    const lines = capture(t);
    logTickFailure('territory lifecycle sweep', POOL_FULL());
    logTickFailure('territory lifecycle sweep', new Error('relation "kv_store" does not exist'));
    assert.match(lines[0]!, /^warn \[cron-scheduler\] territory lifecycle sweep deferred to the next tick \(storage busy\):/);
    assert.match(lines[1]!, /^error \[cron-scheduler\] territory lifecycle sweep threw: relation/);
});

test('a refused boot settlement pass does not lose the legacy scan: the next tick runs it', async (t) => {
    capture(t);
    // A legacy journal: stale, with no pending pointer, so only a legacy scan finds it.
    const transactionId = settlementTransactionId('test-legacy-scan', 'boot-refused');
    const created = await beginDurableSettlement({
        transactionId, idempotencyKey: 'boot-refused', operationType: 'test-legacy-scan',
        fingerprint: 'legacy-fingerprint', actorIds: ['alice'], resource: 'ryo', amount: 1,
    }, { kv });
    const old = Date.now() - 24 * 60 * 60 * 1000;
    await kv.set(durableSettlementKey(transactionId), { ...created.record, createdAt: old, updatedAt: old });
    await kv.del(`${DURABLE_SETTLEMENT_PENDING_PREFIX}${transactionId}`);

    // The boot pass (the only one that asked for the legacy scan) is refused.
    const set = kv.set.bind(kv);
    let refused = false;
    t.mock.method(kv, 'set', async (...args: Parameters<typeof kv.set>) => {
        if (!refused && String(args[0]).includes('settlement-reconciliation')) { refused = true; throw POOL_FULL(); }
        return set(...args);
    });
    await fireSettlementReconciliation(true);
    assert.ok(refused, 'the boot pass hit the refusal');
    assert.notEqual((await getDurableSettlement(transactionId, { kv }))?.state, 'reconciliation-required');

    // An ordinary tick, which used to run without the legacy scan.
    await fireSettlementReconciliation(false);
    assert.equal((await getDurableSettlement(transactionId, { kv }))?.state, 'reconciliation-required', 'the legacy scan ran on the next tick');
});

test('a fresh marker still short-circuits the catch-up', async (t) => {
    const lines = capture(t);
    const marker: SnapshotSuccessMarker = { completedAt: Date.now() - 22 * 60 * 60 * 1000, snapshotted: 14, skipped: 259, total: 273, elapsedMs: 14_646 };
    await kv.set(SNAPSHOT_SUCCESS_KEY, marker);
    const keys = t.mock.method(kv, 'keys');
    await runBootSnapshotCatchUpCore();
    assert.ok(lines.some((line) => line.includes('backup freshness ok')), lines.join('\n'));
    assert.ok(!lines.some((line) => line.includes('boot catch-up:')), 'no snapshot pass ran');
    assert.equal(keys.mock.callCount(), 0);
});
