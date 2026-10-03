import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { drainBackgroundWork } from './_background-work.js';
import { assertKvLockContext, currentKvLockContext, poisonKvLockContext, withKvLeaseContext } from './_kv-lock-context.js';
import {
    recordEconomyTxn,
    readEconomySnapshot,
    applyTxnToAgg,
    duplicateTxnIds,
    econAggKey,
    ECON_TXN_LIST_KEY,
    type EconTxn,
} from './_economy.js';

// Minimal in-memory KV with just get/set (what _economy needs).
function memKv() {
    const m = new Map<string, unknown>();
    return {
        async get<T>(k: string): Promise<T | null> { return (m.has(k) ? m.get(k) : null) as T | null; },
        async set(k: string, v: unknown): Promise<'OK'> { m.set(k, v); return 'OK' as const; },
        _m: m,
    };
}

test('applyTxnToAgg routes + to created and − to destroyed; ignores zero', () => {
    assert.deepEqual(applyTxnToAgg({ created: 0, destroyed: 0 }, 100), { created: 100, destroyed: 0 });
    assert.deepEqual(applyTxnToAgg({ created: 100, destroyed: 0 }, -30), { created: 100, destroyed: 30 });
    assert.deepEqual(applyTxnToAgg({ created: 5, destroyed: 5 }, 0), { created: 5, destroyed: 5 });
});

test('recordEconomyTxn accumulates created/destroyed and writes a capped recent list', async () => {
    const store = memKv();
    await recordEconomyTxn({ txnId: 'a', player: 'rill', currency: 'ryo', delta: 2500, source: 'mission.claim' }, { kv: store });
    await recordEconomyTxn({ txnId: 'b', player: 'rill', currency: 'ryo', delta: -250, source: 'trade.burn' }, { kv: store });
    const agg = store._m.get(econAggKey('ryo'));
    assert.deepEqual(agg, { created: 2500, destroyed: 250 });
    const list = store._m.get(ECON_TXN_LIST_KEY) as EconTxn[];
    assert.equal(list.length, 2);
    assert.equal(list[0].txnId, 'b', 'newest-first');
});

test('recordEconomyTxn is a no-op for zero delta and unknown currency', async () => {
    const store = memKv();
    await recordEconomyTxn({ txnId: 'z', player: 'p', currency: 'ryo', delta: 0, source: 's' }, { kv: store });
    await recordEconomyTxn({ txnId: 'u', player: 'p', currency: 'doubloons', delta: 99, source: 's' }, { kv: store });
    assert.equal(store._m.get(ECON_TXN_LIST_KEY), undefined);
    assert.equal(store._m.get(econAggKey('ryo')), undefined);
});

test('duplicateTxnIds flags replays', () => {
    const txns = [
        { txnId: 'x', ts: 1, player: 'p', currency: 'ryo', delta: 1, source: 's' },
        { txnId: 'y', ts: 2, player: 'p', currency: 'ryo', delta: 1, source: 's' },
        { txnId: 'x', ts: 3, player: 'p', currency: 'ryo', delta: 1, source: 's' },
    ] as EconTxn[];
    assert.deepEqual(duplicateTxnIds(txns), ['x']);
});

test('readEconomySnapshot reports net supply per currency + dup flags', async () => {
    const store = memKv();
    await recordEconomyTxn({ txnId: 'm1', player: 'rill', currency: 'ryo', delta: 1000, source: 'mission.claim' }, { kv: store });
    await recordEconomyTxn({ txnId: 'm1', player: 'rill', currency: 'ryo', delta: 1000, source: 'mission.claim' }, { kv: store }); // replay
    await recordEconomyTxn({ txnId: 's1', player: 'rill', currency: 'ryo', delta: -400, source: 'trade.burn' }, { kv: store });
    const snap = await readEconomySnapshot(50, { kv: store });
    assert.deepEqual(snap.aggregates.ryo, { created: 2000, destroyed: 400, net: 1600 });
    assert.deepEqual(snap.duplicateTxnIds, ['m1']);
    assert.equal(snap.recent.length, 3);
});

test('concurrent economy projections preserve aggregate and recent-list counts', async () => {
    const store = memKv();
    await Promise.all(Array.from({ length: 20 }, (_, i) => recordEconomyTxn({
        txnId: `concurrent-${i}`, player: 'rill', currency: 'ryo', delta: 10, source: 'test',
    }, { kv: store })));
    assert.deepEqual(store._m.get(econAggKey('ryo')), { created: 200, destroyed: 0 });
    assert.equal((store._m.get(ECON_TXN_LIST_KEY) as EconTxn[]).length, 20);
});

test('detached economy projection survives parent completion and remains tracked for shutdown', async () => {
    const store = memKv();
    const originalGet = store.get;
    let unblock!: () => void;
    let entered!: () => void;
    const blocked = new Promise<void>((resolve) => { unblock = resolve; });
    const started = new Promise<void>((resolve) => { entered = resolve; });
    store.get = async <T>(key: string): Promise<T | null> => {
        entered();
        await blocked;
        assert.equal(currentKvLockContext(), undefined, 'injected telemetry store must not inherit the save lease');
        assertKvLockContext();
        return originalGet<T>(key);
    };
    let pending!: Promise<void>;
    await withKvLeaseContext('lock:save:economy-observation', 'parent', async () => {
        pending = recordEconomyTxn({ txnId: 'detached', player: 'rill', currency: 'ryo', delta: 17, source: 'test' }, { kv: store });
        await started;
    });
    let drained = false;
    const drain = drainBackgroundWork().then(() => { drained = true; });
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(drained, false, 'storage shutdown must wait for admitted telemetry');
    unblock();
    await pending;
    await drain;
    assert.deepEqual(store._m.get(econAggKey('ryo')), { created: 17, destroyed: 0 });
});

test('failed economy telemetry has independent poison and cannot revive a poisoned currency writer', async () => {
    const store = memKv();
    const failure = new Error('telemetry storage failed');
    store.get = async () => withKvLeaseContext('lock:telemetry:economy-test', 'telemetry', async () => {
        throw poisonKvLockContext(currentKvLockContext()!, failure);
    });
    await withKvLeaseContext('lock:save:economy-poison', 'parent', async () => {
        const parent = currentKvLockContext()!;
        await recordEconomyTxn({ txnId: 'failed', player: 'rill', currency: 'ryo', delta: 17, source: 'test' }, { kv: store });
        assert.equal(parent.health.error, undefined, 'telemetry failure must not poison the real currency write');
        assertKvLockContext();
        store._m.set('save:rill', { ryo: 50 });
        const parentFailure = poisonKvLockContext(parent, new Error('currency lease lost'));
        await recordEconomyTxn({ txnId: 'already-poisoned', player: 'rill', currency: 'ryo', delta: 17, source: 'test' }, { kv: store });
        assert.throws(() => assertKvLockContext(), (error) => error === parentFailure);
        assert.deepEqual(store._m.get('save:rill'), { ryo: 50 });
    });
    assert.equal(store._m.has(ECON_TXN_LIST_KEY), false);
    assert.equal(store._m.has(econAggKey('ryo')), false);
});
