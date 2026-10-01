import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
    __resetSharedAdminItems,
    pullAdminSnapshotsWithDeviceCache,
    rememberSharedAdminItems,
    withSharedAdminItems,
    type AdminSnapshotCache,
} from './shared-admin-content-cache';

type Snap = { slot: string; v: number; creatorItems?: { id: string; v: number }[]; character?: unknown; _saveVersion?: number };

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
const NO_WAIT = { emptyRetryMs: 0 };

test('both live reads succeed: returned in slot order, cache refreshed, and login never waits on a cache read', async () => {
    const mem = memoryCache();
    const out = await pullAdminSnapshotsWithDeviceCache<Snap>(async (slot) => ({ slot, v: 2 }), mem.cache);
    assert.deepEqual(out, [{ slot: 'Admin 1', v: 2 }, { slot: 'Admin 2', v: 2 }]);
    assert.equal(mem.reads, 0);
    await tick();
    assert.equal(mem.writes.length, 1);
});

test('the cache keeps shared content fields only — never the admin character or save stamps', async () => {
    const mem = memoryCache();
    await pullAdminSnapshotsWithDeviceCache<Snap>(async (slot) => ({
        slot, v: 2, creatorItems: [{ id: 'blade', v: 1 }], character: { name: slot, ryo: 9 }, _saveVersion: 4,
    }), mem.cache);
    await tick();
    assert.deepEqual(mem.stored, {
        'Admin 1': { creatorItems: [{ id: 'blade', v: 1 }] },
        'Admin 2': { creatorItems: [{ id: 'blade', v: 1 }] },
    });
});

test('a failed slot falls back to this device’s copy, and the cached copy is applied BEFORE the live one', async () => {
    const mem = memoryCache({ 'Admin 1': { slot: 'Admin 1', v: 1 }, 'Admin 2': { slot: 'Admin 2', v: 1 } });
    const out = await pullAdminSnapshotsWithDeviceCache<Snap>(async (slot) => (slot === 'Admin 1' ? { slot, v: 3 } : null), mem.cache, NO_WAIT);
    // Callers merge by id with later entries winning, so the live Admin 1 must come last.
    assert.deepEqual(out, [{ slot: 'Admin 2', v: 1 }, { slot: 'Admin 1', v: 3 }]);
    await tick();
    assert.deepEqual(mem.stored, { 'Admin 1': {}, 'Admin 2': { slot: 'Admin 2', v: 1 } }, 'the cached slot is kept, the live one refreshed (content fields only)');
});

test('a throwing live read is treated as a failed slot, not a failed pull', async () => {
    const mem = memoryCache({ 'Admin 2': { slot: 'Admin 2', v: 1 } });
    const out = await pullAdminSnapshotsWithDeviceCache<Snap>(async (slot) => {
        if (slot === 'Admin 2') throw new Error('network');
        return { slot, v: 2 };
    }, mem.cache, NO_WAIT);
    assert.deepEqual(out, [{ slot: 'Admin 2', v: 1 }, { slot: 'Admin 1', v: 2 }]);
});

test('nothing live and no cache: one delayed live retry, and its result is returned', async () => {
    const mem = memoryCache(null);
    let calls = 0;
    const out = await pullAdminSnapshotsWithDeviceCache<Snap>(async (slot) => (++calls > 2 ? { slot, v: 5 } : null), mem.cache, NO_WAIT);
    assert.equal(calls, 4, 'two slots, two attempts');
    assert.deepEqual(out, [{ slot: 'Admin 1', v: 5 }, { slot: 'Admin 2', v: 5 }]);
});

test('everything failing twice with no cache returns nothing and writes nothing', async () => {
    const mem = memoryCache(null);
    const out = await pullAdminSnapshotsWithDeviceCache<Snap>(async () => null, mem.cache, NO_WAIT);
    assert.deepEqual(out, []);
    assert.equal(mem.writes.length, 0);
});

test('a broken device store never breaks the pull', async () => {
    const broken: AdminSnapshotCache<Snap> = {
        async read() { throw new Error('quota'); },
        async write() { throw new Error('quota'); },
    };
    assert.deepEqual(await pullAdminSnapshotsWithDeviceCache<Snap>(async () => null, broken, NO_WAIT), []);
    assert.deepEqual(await pullAdminSnapshotsWithDeviceCache<Snap>(async (slot) => ({ slot, v: 1 }), broken), [{ slot: 'Admin 1', v: 1 }, { slot: 'Admin 2', v: 1 }]);
});

test('without IndexedDB (this runner) the default cache is a no-op, not an error', async () => {
    assert.deepEqual(await pullAdminSnapshotsWithDeviceCache<Snap>(async () => null, undefined, NO_WAIT), []);
});

test('a save refetch keeps the admin items applied this page; admin definitions win a collision', () => {
    __resetSharedAdminItems();
    assert.deepEqual(withSharedAdminItems([{ id: 'own', v: 1 }]), [{ id: 'own', v: 1 }], 'nothing remembered yet: the save alone');
    rememberSharedAdminItems([{ id: 'admin-blade', v: 1 }, { id: 'shared', v: 9 }]);
    rememberSharedAdminItems([{ id: 'admin-blade', v: 2 }]);
    const merged = withSharedAdminItems([{ id: 'own', v: 1 }, { id: 'shared', v: 0 }]);
    assert.deepEqual(merged.sort((a, b) => a.id.localeCompare(b.id)), [
        { id: 'admin-blade', v: 2 },
        { id: 'own', v: 1 },
        { id: 'shared', v: 9 },
    ]);
    __resetSharedAdminItems();
});
