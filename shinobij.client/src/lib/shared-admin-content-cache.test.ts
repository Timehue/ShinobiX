import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pullAdminSnapshotsWithDeviceCache, type AdminSnapshotCache } from './shared-admin-content-cache';

type Snap = { slot: string; v: number };

function memoryCache(initial: Partial<Record<'Admin 1' | 'Admin 2', Snap>> | null = null) {
    let stored = initial;
    let reads = 0;
    const writes: unknown[] = [];
    const cache: AdminSnapshotCache<Snap> = {
        async read() { reads += 1; return stored; },
        async write(slots) { writes.push(slots); stored = slots; },
    };
    return { cache, get stored() { return stored; }, get reads() { return reads; }, writes };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

test('both live reads succeed: returned as-is, cache refreshed, and login never waits on a cache read', async () => {
    const mem = memoryCache();
    const out = await pullAdminSnapshotsWithDeviceCache<Snap>(async (slot) => ({ slot, v: 2 }), mem.cache);
    assert.deepEqual(out, [{ slot: 'Admin 1', v: 2 }, { slot: 'Admin 2', v: 2 }]);
    assert.equal(mem.reads, 0);
    await tick();
    assert.deepEqual(mem.stored, { 'Admin 1': { slot: 'Admin 1', v: 2 }, 'Admin 2': { slot: 'Admin 2', v: 2 } });
});

test('a failed slot falls back to this device’s last good copy; the live slot still wins', async () => {
    const mem = memoryCache({ 'Admin 1': { slot: 'Admin 1', v: 1 }, 'Admin 2': { slot: 'Admin 2', v: 1 } });
    const out = await pullAdminSnapshotsWithDeviceCache<Snap>(async (slot) => (slot === 'Admin 2' ? { slot, v: 3 } : null), mem.cache);
    assert.deepEqual(out, [{ slot: 'Admin 1', v: 1 }, { slot: 'Admin 2', v: 3 }]);
    await tick();
    assert.deepEqual(mem.stored, { 'Admin 1': { slot: 'Admin 1', v: 1 }, 'Admin 2': { slot: 'Admin 2', v: 3 } }, 'the cached slot is kept, the live one refreshed');
});

test('everything failing with no cache returns nulls — exactly today’s behaviour', async () => {
    const mem = memoryCache(null);
    const out = await pullAdminSnapshotsWithDeviceCache<Snap>(async () => null, mem.cache);
    assert.deepEqual(out, [null, null]);
    assert.equal(mem.writes.length, 0);
});

test('a broken device store never breaks the pull', async () => {
    const broken: AdminSnapshotCache<Snap> = {
        async read() { throw new Error('quota'); },
        async write() { throw new Error('quota'); },
    };
    assert.deepEqual(await pullAdminSnapshotsWithDeviceCache<Snap>(async () => null, broken), [null, null]);
    assert.deepEqual(await pullAdminSnapshotsWithDeviceCache<Snap>(async (slot) => ({ slot, v: 1 }), broken), [{ slot: 'Admin 1', v: 1 }, { slot: 'Admin 2', v: 1 }]);
});

test('without IndexedDB (this runner) the default cache is a no-op, not an error', async () => {
    assert.deepEqual(await pullAdminSnapshotsWithDeviceCache<Snap>(async () => null), [null, null]);
});
