"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const node_assert_1 = require("node:assert");
const _economy_tx_js_1 = require("./_economy-tx.js");
function memKv() {
    const store = new Map();
    return {
        async get(key) {
            return store.has(key) ? store.get(key) : null;
        },
        async set(key, value, opts) {
            void opts?.ex;
            if (opts?.nx && store.has(key))
                return null;
            store.set(key, value);
            return 'OK';
        },
    };
}
(0, node_test_1.describe)('_economy-tx', () => {
    (0, node_test_1.it)('reserves a transaction and lists it in recent snapshot', async () => {
        const kv = memKv();
        const tx = await (0, _economy_tx_js_1.reserveEconomyTx)({
            id: 'tx-1',
            kind: 'test',
            debitKey: 'a',
            creditKey: 'b',
            resource: 'ryo',
            amount: 10,
        }, { kv });
        node_assert_1.strict.equal(tx.state, 'reserved');
        const snapshot = await (0, _economy_tx_js_1.readEconomyTxSnapshot)(10, { kv });
        node_assert_1.strict.equal(snapshot.recent.length, 1);
        node_assert_1.strict.equal(snapshot.stuck[0]?.id, 'tx-1');
    });
    (0, node_test_1.it)('keeps duplicate reserve idempotent', async () => {
        const kv = memKv();
        await (0, _economy_tx_js_1.reserveEconomyTx)({ id: 'tx-1', kind: 'test', debitKey: 'a', creditKey: 'b', resource: 'ryo', amount: 10 }, { kv });
        const again = await (0, _economy_tx_js_1.reserveEconomyTx)({ id: 'tx-1', kind: 'test', debitKey: 'a', creditKey: 'b', resource: 'ryo', amount: 99 }, { kv });
        node_assert_1.strict.equal(again.amount, 10);
    });
    (0, node_test_1.it)('tracks state transitions and removes completed txs from stuck', async () => {
        const kv = memKv();
        await (0, _economy_tx_js_1.reserveEconomyTx)({ id: 'tx-1', kind: 'test', debitKey: 'a', creditKey: 'b', resource: 'ryo', amount: 10 }, { kv });
        await (0, _economy_tx_js_1.markEconomyTx)('tx-1', 'debit-applied', {}, { kv });
        node_assert_1.strict.equal((await (0, _economy_tx_js_1.readEconomyTxSnapshot)(10, { kv })).stuck[0]?.state, 'debit-applied');
        await (0, _economy_tx_js_1.completeEconomyTx)('tx-1', {}, { kv });
        node_assert_1.strict.equal((await (0, _economy_tx_js_1.readEconomyTxSnapshot)(10, { kv })).stuck.length, 0);
    });
    (0, node_test_1.it)('marks failed partial transactions for reconciliation', async () => {
        const kv = memKv();
        await (0, _economy_tx_js_1.failEconomyTx)('tx-2', new Error('boom'), { kind: 'test', debitKey: 'a', creditKey: 'b', resource: 'ryo', amount: 10 }, { kv });
        const snapshot = await (0, _economy_tx_js_1.readEconomyTxSnapshot)(10, { kv });
        node_assert_1.strict.equal(snapshot.stuck[0]?.state, 'needs-reconcile');
        node_assert_1.strict.equal(snapshot.stuck[0]?.error, 'boom');
    });
});
