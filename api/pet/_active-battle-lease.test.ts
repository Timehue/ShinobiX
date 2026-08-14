import test from 'node:test';
import assert from 'node:assert/strict';
import { claimPetLifecycleLease } from './_active-battle-lease.js';

function memoryStore(options: { loseSetAck?: boolean } = {}) {
    const values = new Map<string, unknown>();
    let loseSetAck = options.loseSetAck === true;
    return {
        values,
        async get<T>(key: string) { return (values.get(key) ?? null) as T | null; },
        async set(key: string, value: unknown, setOptions?: { nx?: boolean }) {
            if (setOptions?.nx && values.has(key)) return null;
            values.set(key, value);
            if (loseSetAck) { loseSetAck = false; throw new Error('lost-set-ack'); }
            return 'OK' as const;
        },
        async delIfEqual(key: string, expected: unknown) {
            if (values.get(key) !== expected) return false;
            values.delete(key);
            return true;
        },
    };
}

test('pet lifecycle lease conflicts with an active battle and never replaces it', async () => {
    const store = memoryStore();
    store.values.set('pet:battle-active:leaseprobe', 'real-battle-token');
    assert.equal(await claimPetLifecycleLease(store, 'leaseprobe', 'progress'), null);
    assert.equal(store.values.get('pet:battle-active:leaseprobe'), 'real-battle-token');
});

test('pet lifecycle lease recovers a lost acknowledgement and compare-deletes only itself', async () => {
    const store = memoryStore({ loseSetAck: true });
    const lease = await claimPetLifecycleLease(store, 'leaseprobe', 'expedition');
    assert.ok(lease);
    assert.equal(store.values.get(lease.key), lease.token);

    store.values.set(lease.key, 'newer-battle-token');
    assert.equal(await lease.release(), false);
    assert.equal(store.values.get(lease.key), 'newer-battle-token');
    assert.equal(await lease.release(), false, 'release is idempotent');
});

test('pet lifecycle lease releases its own sentinel after a successful mutation', async () => {
    const store = memoryStore();
    const lease = await claimPetLifecycleLease(store, 'leaseprobe', 'breeding');
    assert.ok(lease);
    assert.equal(await lease.release(), true);
    assert.equal(store.values.has(lease.key), false);
});
