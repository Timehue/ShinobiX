import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import {
    completeEconomyTx,
    failEconomyTx,
    markEconomyTx,
    readEconomyTxSnapshot,
    reserveEconomyTx,
} from './_economy-tx.js';

function memKv() {
    const store = new Map<string, unknown>();
    return {
        async get<T>(key: string): Promise<T | null> {
            return store.has(key) ? (store.get(key) as T) : null;
        },
        async set<T>(key: string, value: T, opts?: { nx?: boolean; ex?: number }): Promise<'OK' | null> {
            void opts?.ex;
            if (opts?.nx && store.has(key)) return null;
            store.set(key, value);
            return 'OK';
        },
    };
}

describe('_economy-tx', () => {
    it('reserves a transaction and lists it in recent snapshot', async () => {
        const kv = memKv();
        const tx = await reserveEconomyTx({
            id: 'tx-1',
            kind: 'test',
            debitKey: 'a',
            creditKey: 'b',
            resource: 'ryo',
            amount: 10,
        }, { kv });
        assert.equal(tx.state, 'reserved');
        const snapshot = await readEconomyTxSnapshot(10, { kv });
        assert.equal(snapshot.recent.length, 1);
        assert.equal(snapshot.stuck[0]?.id, 'tx-1');
    });

    it('keeps duplicate reserve idempotent', async () => {
        const kv = memKv();
        await reserveEconomyTx({ id: 'tx-1', kind: 'test', debitKey: 'a', creditKey: 'b', resource: 'ryo', amount: 10 }, { kv });
        const again = await reserveEconomyTx({ id: 'tx-1', kind: 'test', debitKey: 'a', creditKey: 'b', resource: 'ryo', amount: 99 }, { kv });
        assert.equal(again.amount, 10);
    });

    it('tracks state transitions and removes completed txs from stuck', async () => {
        const kv = memKv();
        await reserveEconomyTx({ id: 'tx-1', kind: 'test', debitKey: 'a', creditKey: 'b', resource: 'ryo', amount: 10 }, { kv });
        await markEconomyTx('tx-1', 'debit-applied', {}, { kv });
        assert.equal((await readEconomyTxSnapshot(10, { kv })).stuck[0]?.state, 'debit-applied');
        await completeEconomyTx('tx-1', {}, { kv });
        assert.equal((await readEconomyTxSnapshot(10, { kv })).stuck.length, 0);
    });

    it('marks failed partial transactions for reconciliation', async () => {
        const kv = memKv();
        await failEconomyTx('tx-2', new Error('boom'), { kind: 'test', debitKey: 'a', creditKey: 'b', resource: 'ryo', amount: 10 }, { kv });
        const snapshot = await readEconomyTxSnapshot(10, { kv });
        assert.equal(snapshot.stuck[0]?.state, 'needs-reconcile');
        assert.equal(snapshot.stuck[0]?.error, 'boom');
    });
});
