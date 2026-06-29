"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const node_assert_1 = require("node:assert");
const _economy_js_1 = require("./_economy.js");
// Minimal in-memory KV with just get/set (what _economy needs).
function memKv() {
    const m = new Map();
    return {
        async get(k) { return (m.has(k) ? m.get(k) : null); },
        async set(k, v) { m.set(k, v); return 'OK'; },
        _m: m,
    };
}
(0, node_test_1.test)('applyTxnToAgg routes + to created and − to destroyed; ignores zero', () => {
    node_assert_1.strict.deepEqual((0, _economy_js_1.applyTxnToAgg)({ created: 0, destroyed: 0 }, 100), { created: 100, destroyed: 0 });
    node_assert_1.strict.deepEqual((0, _economy_js_1.applyTxnToAgg)({ created: 100, destroyed: 0 }, -30), { created: 100, destroyed: 30 });
    node_assert_1.strict.deepEqual((0, _economy_js_1.applyTxnToAgg)({ created: 5, destroyed: 5 }, 0), { created: 5, destroyed: 5 });
});
(0, node_test_1.test)('recordEconomyTxn accumulates created/destroyed and writes a capped recent list', async () => {
    const store = memKv();
    await (0, _economy_js_1.recordEconomyTxn)({ txnId: 'a', player: 'rill', currency: 'ryo', delta: 2500, source: 'mission.claim' }, { kv: store });
    await (0, _economy_js_1.recordEconomyTxn)({ txnId: 'b', player: 'rill', currency: 'ryo', delta: -250, source: 'trade.burn' }, { kv: store });
    const agg = store._m.get((0, _economy_js_1.econAggKey)('ryo'));
    node_assert_1.strict.deepEqual(agg, { created: 2500, destroyed: 250 });
    const list = store._m.get(_economy_js_1.ECON_TXN_LIST_KEY);
    node_assert_1.strict.equal(list.length, 2);
    node_assert_1.strict.equal(list[0].txnId, 'b', 'newest-first');
});
(0, node_test_1.test)('recordEconomyTxn is a no-op for zero delta and unknown currency', async () => {
    const store = memKv();
    await (0, _economy_js_1.recordEconomyTxn)({ txnId: 'z', player: 'p', currency: 'ryo', delta: 0, source: 's' }, { kv: store });
    await (0, _economy_js_1.recordEconomyTxn)({ txnId: 'u', player: 'p', currency: 'doubloons', delta: 99, source: 's' }, { kv: store });
    node_assert_1.strict.equal(store._m.get(_economy_js_1.ECON_TXN_LIST_KEY), undefined);
    node_assert_1.strict.equal(store._m.get((0, _economy_js_1.econAggKey)('ryo')), undefined);
});
(0, node_test_1.test)('duplicateTxnIds flags replays', () => {
    const txns = [
        { txnId: 'x', ts: 1, player: 'p', currency: 'ryo', delta: 1, source: 's' },
        { txnId: 'y', ts: 2, player: 'p', currency: 'ryo', delta: 1, source: 's' },
        { txnId: 'x', ts: 3, player: 'p', currency: 'ryo', delta: 1, source: 's' },
    ];
    node_assert_1.strict.deepEqual((0, _economy_js_1.duplicateTxnIds)(txns), ['x']);
});
(0, node_test_1.test)('readEconomySnapshot reports net supply per currency + dup flags', async () => {
    const store = memKv();
    await (0, _economy_js_1.recordEconomyTxn)({ txnId: 'm1', player: 'rill', currency: 'ryo', delta: 1000, source: 'mission.claim' }, { kv: store });
    await (0, _economy_js_1.recordEconomyTxn)({ txnId: 'm1', player: 'rill', currency: 'ryo', delta: 1000, source: 'mission.claim' }, { kv: store }); // replay
    await (0, _economy_js_1.recordEconomyTxn)({ txnId: 's1', player: 'rill', currency: 'ryo', delta: -400, source: 'trade.burn' }, { kv: store });
    const snap = await (0, _economy_js_1.readEconomySnapshot)(50, { kv: store });
    node_assert_1.strict.deepEqual(snap.aggregates.ryo, { created: 2000, destroyed: 400, net: 1600 });
    node_assert_1.strict.deepEqual(snap.duplicateTxnIds, ['m1']);
    node_assert_1.strict.equal(snap.recent.length, 3);
});
