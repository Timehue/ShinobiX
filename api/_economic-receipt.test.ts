import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import {
    EconomicReceiptStorageError,
    abortEconomicReceipt,
    commitEconomicReceipt,
    reserveEconomicReceipt,
    type EconomicReceiptRecord,
} from './_economic-receipt.js';

class ReceiptStore {
    values = new Map<string, unknown>();
    failSet = false;
    failGet = false;

    async get<T>(key: string): Promise<T | null> {
        if (this.failGet) throw new Error('injected get failure');
        return (this.values.get(key) as T | undefined) ?? null;
    }

    async set(key: string, value: unknown, options?: { nx?: boolean }): Promise<'OK' | null> {
        if (this.failSet) throw new Error('injected set failure');
        if (options?.nx && this.values.has(key)) return null;
        this.values.set(key, value);
        return 'OK';
    }

    async del(...keys: string[]): Promise<number> {
        let deleted = 0;
        for (const key of keys) {
            if (this.values.delete(key)) deleted += 1;
        }
        return deleted;
    }
}

const reserve = (store: ReceiptStore, fingerprint: string) => reserveEconomicReceipt(store, {
    key: 'reward:one',
    fingerprint,
    ttlSeconds: 60,
});

describe('_economic-receipt', () => {
    it('reserves once and fails closed while an identical mutation is still pending', async () => {
        const store = new ReceiptStore();
        assert.equal((await reserve(store, 'winner:a')).status, 'reserved');
        await assert.rejects(() => reserve(store, 'winner:a'), (error: unknown) => {
            assert.ok(error instanceof EconomicReceiptStorageError);
            assert.equal(error.operation, 'pending');
            return true;
        });
    });

    it('rejects a conflicting report for the same protected entity', async () => {
        const store = new ReceiptStore();
        await reserve(store, 'winner:a');
        const conflict = await reserve(store, 'winner:b');
        assert.equal(conflict.status, 'conflict');
        assert.equal(conflict.receipt.fingerprint, 'winner:a');
    });

    it('fails closed when the NX reservation write fails', async () => {
        const store = new ReceiptStore();
        store.failSet = true;
        await assert.rejects(() => reserve(store, 'winner:a'), (error: unknown) => {
            assert.ok(error instanceof EconomicReceiptStorageError);
            assert.equal(error.operation, 'reserve');
            return true;
        });
        assert.equal(store.values.size, 0);
    });

    it('fails closed when a collision cannot be read back', async () => {
        const store = new ReceiptStore();
        store.values.set('reward:one', { version: 1, fingerprint: 'winner:a', createdAt: 1 });
        store.failGet = true;
        await assert.rejects(() => reserve(store, 'winner:a'), EconomicReceiptStorageError);
    });

    it('treats legacy scalar latches as spent instead of granting again', async () => {
        const store = new ReceiptStore();
        store.values.set('reward:one', '1');
        const result = await reserve(store, 'winner:a');
        assert.deepEqual(result, { status: 'replay', receipt: null });
    });

    it('fails closed on an ambiguous NX collision without a readable row', async () => {
        const store = new ReceiptStore();
        store.set = async () => null;
        await assert.rejects(() => reserve(store, 'winner:a'), EconomicReceiptStorageError);
    });

    it('commits a successful owned reservation and preserves replay protection', async () => {
        const store = new ReceiptStore();
        const reservation = await reserve(store, 'winner:a');
        assert.equal(reservation.status, 'reserved');
        await commitEconomicReceipt(store, 'reward:one', reservation, 3600);
        const stored = store.values.get('reward:one') as EconomicReceiptRecord;
        assert.equal(stored.state, 'committed');
        assert.equal((await reserve(store, 'winner:a')).status, 'replay');
    });

    it('aborts only its own failed pending mutation so a retry can reserve', async () => {
        const store = new ReceiptStore();
        const reservation = await reserve(store, 'winner:a');
        assert.equal(await abortEconomicReceipt(store, 'reward:one', reservation), true);
        assert.equal(store.values.has('reward:one:pending'), true, 'lease remains until its short TTL expires');
        await assert.rejects(() => reserve(store, 'winner:a'), EconomicReceiptStorageError);
        store.values.delete('reward:one:pending'); // simulate lease expiry
        assert.equal((await reserve(store, 'winner:a')).status, 'reserved');
    });

    it('cannot abort another owner or a committed receipt', async () => {
        const store = new ReceiptStore();
        const mine = await reserve(store, 'winner:a');
        assert.equal(mine.status, 'reserved');
        const foreign = mine.status === 'reserved'
            ? { status: 'reserved' as const, receipt: { ...mine.receipt, ownerId: 'foreign-owner' } }
            : mine;
        assert.equal(await abortEconomicReceipt(store, 'reward:one', foreign), false);
        await commitEconomicReceipt(store, 'reward:one', mine, 60);
        assert.equal(await abortEconomicReceipt(store, 'reward:one', mine), false);
        assert.equal((store.values.get('reward:one') as EconomicReceiptRecord).state, 'committed');
    });

    it('cannot commit through a successor pending lease', async () => {
        const store = new ReceiptStore();
        const old = await reserve(store, 'winner:a');
        assert.equal(old.status, 'reserved');
        const oldRecord = old.status === 'reserved' ? old.receipt : null;
        assert.ok(oldRecord);
        store.values.set('reward:one:pending', {
            ...oldRecord,
            ownerId: 'successor',
            leaseExpiresAt: Date.now() + 60_000,
        });
        await assert.rejects(
            () => commitEconomicReceipt(store, 'reward:one', old, 60),
            EconomicReceiptStorageError,
        );
        assert.equal(store.values.has('reward:one'), false);
    });
});
