import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryOnlineStateStore } from './online-store.js';

// Deterministic fake clock so staleness is testable without sleeps.
function makeStore(offlineAfterMs = 60_000) {
    let t = 1_000;
    const store = new MemoryOnlineStateStore({ offlineAfterMs, now: () => t });
    return { store, advance: (ms: number) => { t += ms; }, at: () => t };
}

test('upsert is case-insensitive; get/list reflect it', () => {
    const { store } = makeStore();
    store.upsert({ name: 'Rill', sector: 40, character: { level: 5 } });
    const p = store.get('rill');
    assert.ok(p, 'lookup is case-insensitive');
    assert.equal(p!.name, 'rill');
    assert.equal(p!.displayName, 'Rill');
    assert.equal(p!.sector, 40);
    assert.equal(store.list().length, 1);
    assert.equal(store.size(), 1);
});

test('upsert preserves pendingAttacker and connectedAt across beats', () => {
    const { store, advance } = makeStore();
    const first = store.upsert({ name: 'rill', sector: 1, character: null });
    assert.equal(store.setPendingAttacker('rill', { name: 'zayah' }), true);
    advance(2_000);
    const second = store.upsert({ name: 'rill', sector: 2, character: null });
    assert.equal(second.connectedAt, first.connectedAt, 'connectedAt is stable');
    assert.deepEqual(second.pendingAttacker, { name: 'zayah' }, 'pendingAttacker survives a refresh');
    assert.equal(second.sector, 2, 'sector updates');
});

test('character falls back to the previously-stored slim character', () => {
    const { store } = makeStore();
    store.upsert({ name: 'rill', sector: 1, character: { level: 9 } });
    const next = store.upsert({ name: 'rill', sector: 1, character: null });
    assert.deepEqual(next.character, { level: 9 });
});

test('stale entries disappear from get/list and are removed by sweepStale', () => {
    const { store, advance } = makeStore(60_000);
    store.upsert({ name: 'rill', sector: 1, character: null });
    assert.equal(store.list().length, 1);
    advance(60_001); // just past the offline window
    assert.equal(store.get('rill'), null, 'stale get returns null');
    assert.equal(store.list().length, 0, 'stale entry excluded from list');
    assert.equal(store.size(), 1, 'still in the map until swept');
    const removed = store.sweepStale();
    assert.deepEqual(removed, ['rill']);
    assert.equal(store.size(), 0, 'swept out of the map');
});

test('setPendingAttacker returns false for an offline target', () => {
    const { store, advance } = makeStore(60_000);
    store.upsert({ name: 'rill', sector: 1, character: null });
    advance(60_001);
    assert.equal(store.setPendingAttacker('rill', { name: 'x' }), false, 'cannot queue on a stale target');
    assert.equal(store.setPendingAttacker('ghost', { name: 'x' }), false, 'cannot queue on an absent target');
});

test('clearPendingAttacker and setInBattle mutate in place', () => {
    const { store } = makeStore();
    store.upsert({ name: 'rill', sector: 1, character: null });
    store.setPendingAttacker('rill', { name: 'z' });
    store.clearPendingAttacker('rill');
    assert.equal(store.get('rill')!.pendingAttacker, null);
    store.setInBattle('rill', true);
    assert.equal(store.get('rill')!.inBattle, true);
    store.setInBattle('rill', false);
    assert.equal(store.get('rill')!.inBattle, undefined, 'false clears the flag');
});

test('remove forgets the player', () => {
    const { store } = makeStore();
    store.upsert({ name: 'rill', sector: 1, character: null });
    store.remove('RILL');
    assert.equal(store.get('rill'), null);
    assert.equal(store.size(), 0);
});
