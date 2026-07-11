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
    throwAfterSet = false;

    async get<T>(key: string): Promise<T | null> {
        if (this.failGet) throw new Error('injected get failure');
        return (this.values.get(key) as T | undefined) ?? null;
    }

    async set(key: string, value: unknown, options?: { ex?: number; nx?: boolean }): Promise<'OK' | null> {
        if (this.failSet) throw new Error('injected set failure');
        if (options?.nx && this.values.has(key)) return null;
        this.values.set(key, value);
        if (this.throwAfterSet) throw new Error('injected lost set acknowledgement');
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

    it('recovers its exact pending owner after an NX acknowledgement is lost', async () => {
        const store = new ReceiptStore();
        store.throwAfterSet = true;
        const reservation = await reserve(store, 'winner:a');
        assert.equal(reservation.status, 'reserved');
        assert.equal((store.values.get('reward:one') as EconomicReceiptRecord).ownerId, reservation.receipt.ownerId);
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
        assert.equal(stored.version, 4);
        assert.equal((await reserve(store, 'winner:a')).status, 'replay');
    });

    it('recovers when the committed transition applies but its acknowledgement is lost', async () => {
        const store = new ReceiptStore();
        const reservation = await reserve(store, 'winner:a');
        store.throwAfterSet = true;
        await commitEconomicReceipt(store, 'reward:one', reservation, 3600);
        assert.equal((store.values.get('reward:one') as EconomicReceiptRecord).state, 'committed');
    });

    it('aborts only its own failed pending mutation behind a short tombstone', async () => {
        const store = new ReceiptStore();
        const reservation = await reserve(store, 'winner:a');
        assert.equal(await abortEconomicReceipt(store, 'reward:one', reservation), true);
        assert.equal((store.values.get('reward:one') as EconomicReceiptRecord).state, 'aborted');
        await assert.rejects(() => reserve(store, 'winner:a'), EconomicReceiptStorageError);
        store.values.delete('reward:one'); // simulate the short abort tombstone expiring
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
        store.values.set('reward:one', {
            ...oldRecord,
            ownerId: 'successor',
            leaseExpiresAt: Date.now() + 60_000,
        });
        await assert.rejects(
            () => commitEconomicReceipt(store, 'reward:one', old, 60),
            EconomicReceiptStorageError,
        );
        assert.equal((store.values.get('reward:one') as EconomicReceiptRecord).ownerId, 'successor');
    });

    it('keeps an uncertain post-mutation commit failure durable and never re-reserves it', async () => {
        const store = new ReceiptStore();
        const reservation = await reserve(store, 'winner:a');
        assert.equal(reservation.status, 'reserved');

        // Model the critical window: the protected save write succeeded, then
        // the receipt transition failed. The pending primary row must survive.
        store.failSet = true;
        await assert.rejects(
            () => commitEconomicReceipt(store, 'reward:one', reservation, 3600),
            EconomicReceiptStorageError,
        );
        store.failSet = false;
        const pending = store.values.get('reward:one') as EconomicReceiptRecord;
        assert.equal(pending.state, 'pending');

        // Once the active request lease is stale, the durable pending record is
        // an uncertain replay: deny another mutation instead of paying twice.
        pending.leaseExpiresAt = 1;
        store.values.set('reward:one', pending);
        const retry = await reserveEconomicReceipt(store, {
            key: 'reward:one',
            fingerprint: 'winner:a',
            ttlSeconds: 3600,
            now: Date.now(),
        });
        assert.equal(retry.status, 'replay');
        assert.equal(retry.receipt?.state, 'pending');
    });

    it('honors an active legacy v3 pending lease during a rolling deploy', async () => {
        const store = new ReceiptStore();
        store.values.set('reward:one:pending', {
            version: 3,
            state: 'pending',
            ownerId: 'legacy-owner',
            fingerprint: 'winner:a',
            createdAt: Date.now(),
            leaseExpiresAt: Date.now() + 60_000,
        });
        await assert.rejects(() => reserve(store, 'winner:a'), (error: unknown) => {
            assert.ok(error instanceof EconomicReceiptStorageError);
            assert.equal(error.operation, 'pending');
            return true;
        });
        assert.equal(store.values.has('reward:one'), false);
    });
});
