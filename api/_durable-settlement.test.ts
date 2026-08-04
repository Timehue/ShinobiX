import { test } from 'node:test';
import assert from 'node:assert/strict';
import { _makeMemoryKv } from './_storage.js';
import {
    appendSettlementReceipt,
    beginDurableSettlement,
    cancelDurableSettlement,
    completeDurableSettlement,
    DURABLE_SETTLEMENT_RECONCILIATION_STATUS,
    DURABLE_SETTLEMENT_PENDING_PREFIX,
    durableSettlementKey,
    getDurableSettlement,
    inspectSettlementReceipt,
    listPendingDurableSettlements,
    reconcileStaleDurableSettlements,
    settlementFingerprint,
    settlementTransactionId,
    updateDurableSettlement,
} from './_durable-settlement.js';

test('durable settlement identity is immutable and conflicts are explicit', async () => {
    const kv = _makeMemoryKv();
    const transactionId = settlementTransactionId('test-transfer', 'request-1');
    const fingerprint = settlementFingerprint({ actor: 'alice', amount: 5, resource: 'ryo' });
    const first = await beginDurableSettlement({
        transactionId,
        idempotencyKey: 'request-1',
        operationType: 'test-transfer',
        fingerprint,
        actorIds: ['alice', 'bob'],
        resource: 'ryo',
        amount: 5,
    }, { kv });
    assert.equal(first.status, 'created');

    const replay = await beginDurableSettlement({
        transactionId,
        idempotencyKey: 'request-1',
        operationType: 'test-transfer',
        fingerprint,
        actorIds: ['alice', 'bob'],
        resource: 'ryo',
        amount: 5,
    }, { kv });
    assert.equal(replay.status, 'existing');
    assert.equal(replay.record.transactionId, transactionId);

    const conflict = await beginDurableSettlement({
        transactionId,
        idempotencyKey: 'request-1',
        operationType: 'test-transfer',
        fingerprint: settlementFingerprint({ actor: 'alice', amount: 50, resource: 'ryo' }),
        actorIds: ['alice', 'mallory'],
        resource: 'ryo',
        amount: 50,
    }, { kv });
    assert.equal(conflict.status, 'conflict');
    assert.equal(conflict.record.amount, 5);
});

test('pending records remain discoverable when the secondary index write fails', async () => {
    const kv = _makeMemoryKv();
    const originalSet = kv.set.bind(kv);
    let failIndex = true;
    kv.set = async (key, value, options) => {
        if (failIndex && key === 'economy-settlement:index') throw new Error('injected index failure');
        return originalSet(key, value, options);
    };
    const transactionId = settlementTransactionId('test-recovery', 'request-2');
    await assert.rejects(() => beginDurableSettlement({
        transactionId,
        idempotencyKey: 'request-2',
        operationType: 'test-recovery',
        fingerprint: 'fingerprint-2',
        actorIds: ['alice'],
        resource: 'honorSeals',
        amount: 3,
    }, { kv }), /injected index failure/);

    failIndex = false;
    const pending = await listPendingDurableSettlements({ kv });
    assert.deepEqual(pending.map((record) => record.transactionId), [transactionId]);
});

test('completion write failure is retryable and receipt application is exactly once', async () => {
    const kv = _makeMemoryKv();
    const transactionId = settlementTransactionId('test-complete', 'request-3');
    await beginDurableSettlement({
        transactionId,
        idempotencyKey: 'request-3',
        operationType: 'test-complete',
        fingerprint: 'fingerprint-3',
        actorIds: ['alice', 'bob'],
        resource: 'ryo',
        amount: 7,
    }, { kv });
    const container: Record<string, unknown> = {};
    const receipt = { transactionId, fingerprint: 'fingerprint-3', resource: 'ryo', amount: 7, appliedAt: Date.now() };
    assert.equal(inspectSettlementReceipt(container, transactionId, receipt.fingerprint), 'fresh');
    Object.assign(container, appendSettlementReceipt(container, receipt));
    assert.equal(inspectSettlementReceipt(container, transactionId, receipt.fingerprint), 'replay');
    assert.equal(inspectSettlementReceipt(container, transactionId, 'other-fingerprint'), 'conflict');

    const key = `economy-settlement:${transactionId}`;
    const originalSet = kv.set.bind(kv);
    let failCompletion = true;
    kv.set = async (writeKey, value, options) => {
        if (failCompletion && writeKey === key) throw new Error('injected completion failure');
        return originalSet(writeKey, value, options);
    };
    await assert.rejects(() => completeDurableSettlement(transactionId, { ok: true }, { kv }), /injected completion failure/);
    failCompletion = false;
    const completed = await completeDurableSettlement(transactionId, { ok: true }, { kv });
    assert.equal(completed.state, 'completed');
    assert.deepEqual(completed.result, { ok: true });
    assert.equal(await getDurableSettlement(transactionId, { kv }).then((record) => record?.state), 'completed');
    assert.equal((await listPendingDurableSettlements({ kv })).length, 0);
});

test('state transitions increment attempts and preserve the same transaction', async () => {
    const kv = _makeMemoryKv();
    const transactionId = settlementTransactionId('test-state', 'request-4');
    await beginDurableSettlement({
        transactionId,
        idempotencyKey: 'request-4',
        operationType: 'test-state',
        fingerprint: 'fingerprint-4',
        actorIds: ['alice'],
        resource: 'miraa',
        amount: 10,
    }, { kv });
    const reserved = await updateDurableSettlement(transactionId, { state: 'reserved', meta: { sealed: true } }, { kv });
    assert.equal(reserved.attempts, 1);
    assert.equal(reserved.state, 'reserved');
    assert.deepEqual(reserved.meta, { sealed: true });
    const pending = await listPendingDurableSettlements({ kv });
    assert.equal(pending[0]?.transactionId, transactionId);
});

test('business-rule cancellation is terminal for scanning but retryable with the same identity', async () => {
    const kv = _makeMemoryKv();
    const transactionId = settlementTransactionId('test-cancel', 'request-5');
    await beginDurableSettlement({
        transactionId,
        idempotencyKey: 'request-5',
        operationType: 'test-cancel',
        fingerprint: 'fingerprint-5',
        actorIds: ['alice'],
        resource: 'ryo',
        amount: 50,
    }, { kv });
    const cancelled = await cancelDurableSettlement(transactionId, { status: 400, error: 'Insufficient balance.' }, { kv });
    assert.equal(cancelled.state, 'cancelled');
    assert.equal((await listPendingDurableSettlements({ kv })).length, 0);

    const retry = await beginDurableSettlement({
        transactionId,
        idempotencyKey: 'request-5',
        operationType: 'test-cancel',
        fingerprint: 'fingerprint-5',
        actorIds: ['alice'],
        resource: 'ryo',
        amount: 50,
    }, { kv });
    assert.equal(retry.status, 'existing');
    assert.equal(retry.record.state, 'cancelled');
    assert.equal((await completeDurableSettlement(transactionId, { ok: true }, { kv })).state, 'completed');
});

test('bounded reconciliation marks only stale non-terminal settlements and stores scan health', async () => {
    const kv = _makeMemoryKv();
    const now = 100_000;
    const staleId = settlementTransactionId('test-scan', 'stale');
    const freshId = settlementTransactionId('test-scan', 'fresh');
    for (const [transactionId, request] of [[staleId, 'stale'], [freshId, 'fresh']] as const) {
        await beginDurableSettlement({
            transactionId,
            idempotencyKey: request,
            operationType: 'test-scan',
            fingerprint: request,
            actorIds: ['alice'],
            resource: 'ryo',
            amount: 1,
        }, { kv });
        const record = await getDurableSettlement(transactionId, { kv });
        await kv.set(durableSettlementKey(transactionId), {
            ...record,
            createdAt: now - (request === 'stale' ? 10_000 : 500),
            updatedAt: now - (request === 'stale' ? 10_000 : 500),
        });
    }

    const summary = await reconcileStaleDurableSettlements({ kv, now, staleAfterMs: 1_000, limit: 10 });
    assert.equal(summary.markedRequired, 1);
    assert.equal(summary.active, 1);
    assert.equal((await getDurableSettlement(staleId, { kv }))?.state, 'reconciliation-required');
    assert.equal((await getDurableSettlement(freshId, { kv }))?.state, 'pending');
    assert.deepEqual(await kv.get(DURABLE_SETTLEMENT_RECONCILIATION_STATUS), summary);
});

test('reconciliation continues after one journal write fails', async () => {
    const kv = _makeMemoryKv();
    const now = 200_000;
    const ids = ['fail', 'succeed'].map((request) => settlementTransactionId('test-scan-failure', request));
    for (const [index, transactionId] of ids.entries()) {
        await beginDurableSettlement({
            transactionId,
            idempotencyKey: String(index),
            operationType: 'test-scan-failure',
            fingerprint: String(index),
            actorIds: ['alice'],
            resource: 'ryo',
            amount: 1,
        }, { kv });
        const record = await getDurableSettlement(transactionId, { kv });
        await kv.set(durableSettlementKey(transactionId), { ...record, createdAt: now - 10_000 + index, updatedAt: now - 10_000 + index });
    }
    const originalSet = kv.set.bind(kv);
    let injected = true;
    kv.set = async (key, value, options) => {
        if (injected && key === durableSettlementKey(ids[0]) && (value as { state?: string }).state === 'reconciliation-required') {
            injected = false;
            throw new Error('injected reconciliation write failure');
        }
        return originalSet(key, value, options);
    };
    const summary = await reconcileStaleDurableSettlements({ kv, now, staleAfterMs: 1_000, limit: 10 });
    kv.set = originalSet;
    assert.equal(summary.failures.length, 1);
    assert.equal(summary.markedRequired, 1);
    assert.equal((await getDurableSettlement(ids[1], { kv }))?.state, 'reconciliation-required');
});

test('frequent scans use pending pointers while a legacy scan repairs old journals', async () => {
    const kv = _makeMemoryKv();
    const now = 300_000;
    const transactionId = settlementTransactionId('test-legacy-scan', 'request-legacy');
    const created = await beginDurableSettlement({
        transactionId,
        idempotencyKey: 'request-legacy',
        operationType: 'test-legacy-scan',
        fingerprint: 'legacy-fingerprint',
        actorIds: ['alice'],
        resource: 'ryo',
        amount: 1,
    }, { kv });
    await kv.set(durableSettlementKey(transactionId), { ...created.record, createdAt: now - 10_000, updatedAt: now - 10_000 });
    await kv.del(`${DURABLE_SETTLEMENT_PENDING_PREFIX}${transactionId}`);

    const frequent = await reconcileStaleDurableSettlements({ kv, now, staleAfterMs: 1_000, includeLegacyScan: false });
    assert.equal(frequent.scanned, 0);
    const repair = await reconcileStaleDurableSettlements({ kv, now, staleAfterMs: 1_000, includeLegacyScan: true });
    assert.equal(repair.markedRequired, 1);
    assert.equal((await getDurableSettlement(transactionId, { kv }))?.state, 'reconciliation-required');
    assert.equal(await kv.get(`${DURABLE_SETTLEMENT_PENDING_PREFIX}${transactionId}`), transactionId);
});
