import { test } from 'node:test';
import { strict as assert } from 'node:assert';
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
