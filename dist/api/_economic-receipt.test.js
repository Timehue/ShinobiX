"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const node_assert_1 = require("node:assert");
const _economic_receipt_js_1 = require("./_economic-receipt.js");
class ReceiptStore {
    values = new Map();
    failSet = false;
    failGet = false;
    throwAfterSet = false;
    async get(key) {
        if (this.failGet)
            throw new Error('injected get failure');
        return this.values.get(key) ?? null;
    }
    async set(key, value, options) {
        if (this.failSet)
            throw new Error('injected set failure');
        if (options?.nx && this.values.has(key))
            return null;
        this.values.set(key, value);
        if (this.throwAfterSet)
            throw new Error('injected lost set acknowledgement');
        return 'OK';
    }
    async del(...keys) {
        let deleted = 0;
        for (const key of keys) {
            if (this.values.delete(key))
                deleted += 1;
        }
        return deleted;
    }
}
const reserve = (store, fingerprint) => (0, _economic_receipt_js_1.reserveEconomicReceipt)(store, {
    key: 'reward:one',
    fingerprint,
    ttlSeconds: 60,
});
(0, node_test_1.describe)('_economic-receipt', () => {
    (0, node_test_1.it)('reserves once and fails closed while an identical mutation is still pending', async () => {
        const store = new ReceiptStore();
        node_assert_1.strict.equal((await reserve(store, 'winner:a')).status, 'reserved');
        await node_assert_1.strict.rejects(() => reserve(store, 'winner:a'), (error) => {
            node_assert_1.strict.ok(error instanceof _economic_receipt_js_1.EconomicReceiptStorageError);
            node_assert_1.strict.equal(error.operation, 'pending');
            return true;
        });
    });
    (0, node_test_1.it)('rejects a conflicting report for the same protected entity', async () => {
        const store = new ReceiptStore();
        await reserve(store, 'winner:a');
        const conflict = await reserve(store, 'winner:b');
        node_assert_1.strict.equal(conflict.status, 'conflict');
        node_assert_1.strict.equal(conflict.receipt.fingerprint, 'winner:a');
    });
    (0, node_test_1.it)('fails closed when the NX reservation write fails', async () => {
        const store = new ReceiptStore();
        store.failSet = true;
        await node_assert_1.strict.rejects(() => reserve(store, 'winner:a'), (error) => {
            node_assert_1.strict.ok(error instanceof _economic_receipt_js_1.EconomicReceiptStorageError);
            node_assert_1.strict.equal(error.operation, 'reserve');
            return true;
        });
        node_assert_1.strict.equal(store.values.size, 0);
    });
    (0, node_test_1.it)('recovers its exact pending owner after an NX acknowledgement is lost', async () => {
        const store = new ReceiptStore();
        store.throwAfterSet = true;
        const reservation = await reserve(store, 'winner:a');
        node_assert_1.strict.equal(reservation.status, 'reserved');
        node_assert_1.strict.equal(store.values.get('reward:one').ownerId, reservation.receipt.ownerId);
    });
    (0, node_test_1.it)('fails closed when a collision cannot be read back', async () => {
        const store = new ReceiptStore();
        store.values.set('reward:one', { version: 1, fingerprint: 'winner:a', createdAt: 1 });
        store.failGet = true;
        await node_assert_1.strict.rejects(() => reserve(store, 'winner:a'), _economic_receipt_js_1.EconomicReceiptStorageError);
    });
    (0, node_test_1.it)('treats legacy scalar latches as spent instead of granting again', async () => {
        const store = new ReceiptStore();
        store.values.set('reward:one', '1');
        const result = await reserve(store, 'winner:a');
        node_assert_1.strict.deepEqual(result, { status: 'replay', receipt: null });
    });
    (0, node_test_1.it)('fails closed on an ambiguous NX collision without a readable row', async () => {
        const store = new ReceiptStore();
        store.set = async () => null;
        await node_assert_1.strict.rejects(() => reserve(store, 'winner:a'), _economic_receipt_js_1.EconomicReceiptStorageError);
    });
    (0, node_test_1.it)('commits a successful owned reservation and preserves replay protection', async () => {
        const store = new ReceiptStore();
        const reservation = await reserve(store, 'winner:a');
        node_assert_1.strict.equal(reservation.status, 'reserved');
        await (0, _economic_receipt_js_1.commitEconomicReceipt)(store, 'reward:one', reservation, 3600);
        const stored = store.values.get('reward:one');
        node_assert_1.strict.equal(stored.state, 'committed');
        node_assert_1.strict.equal(stored.version, 4);
        node_assert_1.strict.equal((await reserve(store, 'winner:a')).status, 'replay');
    });
    (0, node_test_1.it)('recovers when the committed transition applies but its acknowledgement is lost', async () => {
        const store = new ReceiptStore();
        const reservation = await reserve(store, 'winner:a');
        store.throwAfterSet = true;
        await (0, _economic_receipt_js_1.commitEconomicReceipt)(store, 'reward:one', reservation, 3600);
        node_assert_1.strict.equal(store.values.get('reward:one').state, 'committed');
    });
    (0, node_test_1.it)('aborts only its own failed pending mutation behind a short tombstone', async () => {
        const store = new ReceiptStore();
        const reservation = await reserve(store, 'winner:a');
        node_assert_1.strict.equal(await (0, _economic_receipt_js_1.abortEconomicReceipt)(store, 'reward:one', reservation), true);
        node_assert_1.strict.equal(store.values.get('reward:one').state, 'aborted');
        await node_assert_1.strict.rejects(() => reserve(store, 'winner:a'), _economic_receipt_js_1.EconomicReceiptStorageError);
        store.values.delete('reward:one'); // simulate the short abort tombstone expiring
        node_assert_1.strict.equal((await reserve(store, 'winner:a')).status, 'reserved');
    });
    (0, node_test_1.it)('cannot abort another owner or a committed receipt', async () => {
        const store = new ReceiptStore();
        const mine = await reserve(store, 'winner:a');
        node_assert_1.strict.equal(mine.status, 'reserved');
        const foreign = mine.status === 'reserved'
            ? { status: 'reserved', receipt: { ...mine.receipt, ownerId: 'foreign-owner' } }
            : mine;
        node_assert_1.strict.equal(await (0, _economic_receipt_js_1.abortEconomicReceipt)(store, 'reward:one', foreign), false);
        await (0, _economic_receipt_js_1.commitEconomicReceipt)(store, 'reward:one', mine, 60);
        node_assert_1.strict.equal(await (0, _economic_receipt_js_1.abortEconomicReceipt)(store, 'reward:one', mine), false);
        node_assert_1.strict.equal(store.values.get('reward:one').state, 'committed');
    });
    (0, node_test_1.it)('cannot commit through a successor pending lease', async () => {
        const store = new ReceiptStore();
        const old = await reserve(store, 'winner:a');
        node_assert_1.strict.equal(old.status, 'reserved');
        const oldRecord = old.status === 'reserved' ? old.receipt : null;
        node_assert_1.strict.ok(oldRecord);
        store.values.set('reward:one', {
            ...oldRecord,
            ownerId: 'successor',
            leaseExpiresAt: Date.now() + 60_000,
        });
        await node_assert_1.strict.rejects(() => (0, _economic_receipt_js_1.commitEconomicReceipt)(store, 'reward:one', old, 60), _economic_receipt_js_1.EconomicReceiptStorageError);
        node_assert_1.strict.equal(store.values.get('reward:one').ownerId, 'successor');
    });
    (0, node_test_1.it)('keeps an uncertain post-mutation commit failure durable and never re-reserves it', async () => {
        const store = new ReceiptStore();
        const reservation = await reserve(store, 'winner:a');
        node_assert_1.strict.equal(reservation.status, 'reserved');
        // Model the critical window: the protected save write succeeded, then
        // the receipt transition failed. The pending primary row must survive.
        store.failSet = true;
        await node_assert_1.strict.rejects(() => (0, _economic_receipt_js_1.commitEconomicReceipt)(store, 'reward:one', reservation, 3600), _economic_receipt_js_1.EconomicReceiptStorageError);
        store.failSet = false;
        const pending = store.values.get('reward:one');
        node_assert_1.strict.equal(pending.state, 'pending');
        // Once the active request lease is stale, the durable pending record is
        // an uncertain replay: deny another mutation instead of paying twice.
        pending.leaseExpiresAt = 1;
        store.values.set('reward:one', pending);
        const retry = await (0, _economic_receipt_js_1.reserveEconomicReceipt)(store, {
            key: 'reward:one',
            fingerprint: 'winner:a',
            ttlSeconds: 3600,
            now: Date.now(),
        });
        node_assert_1.strict.equal(retry.status, 'replay');
        node_assert_1.strict.equal(retry.receipt?.state, 'pending');
    });
    (0, node_test_1.it)('honors an active legacy v3 pending lease during a rolling deploy', async () => {
        const store = new ReceiptStore();
        store.values.set('reward:one:pending', {
            version: 3,
            state: 'pending',
            ownerId: 'legacy-owner',
            fingerprint: 'winner:a',
            createdAt: Date.now(),
            leaseExpiresAt: Date.now() + 60_000,
        });
        await node_assert_1.strict.rejects(() => reserve(store, 'winner:a'), (error) => {
            node_assert_1.strict.ok(error instanceof _economic_receipt_js_1.EconomicReceiptStorageError);
            node_assert_1.strict.equal(error.operation, 'pending');
            return true;
        });
        node_assert_1.strict.equal(store.values.has('reward:one'), false);
    });
});
