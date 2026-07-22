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

test('upsert preserves pendingAttacker and connectedAt and rejects an unleased teleport', () => {
    const { store, advance } = makeStore();
    const first = store.upsert({ name: 'rill', sector: 1, character: null });
    assert.equal(store.setPendingAttacker('rill', { name: 'zayah' }), true);
    advance(2_000);
    const second = store.upsert({ name: 'rill', sector: 2, character: null });
    assert.equal(second.connectedAt, first.connectedAt, 'connectedAt is stable');
    assert.deepEqual(second.pendingAttacker, { name: 'zayah' }, 'pendingAttacker survives a refresh');
    assert.equal(second.sector, 1, 'presence cannot teleport an established session');
});

test('server-issued travel changes sector only after its arrival deadline', () => {
    const { store, advance, at } = makeStore();
    store.upsert({ name: 'rill', sector: 1, character: null });
    assert.ok(store.startTravel('rill', 2, at() + 3_000));
    assert.equal(store.upsert({ name: 'rill', sector: 2, character: null }).sector, 1);
    advance(3_000);
    assert.equal(store.upsert({ name: 'rill', sector: 2, character: null }).sector, 2);
    assert.equal(store.listSector(1).length, 0);
    assert.deepEqual(store.listSector(2).map((p) => p.name), ['rill']);
});

test('travel OUT of the safe zone survives origin-0 heartbeats during the mask', () => {
    // Regression (the "can't see players in the same sector" outage): a player in
    // the village (sector 0) travels to a wild sector. The client keeps reporting
    // sector 0 — its ORIGIN — for the whole 3s travel mask, because currentSector
    // only flips to the destination on arrival. Those origin-0 beats must NOT be
    // treated as a safe-zone exit that wipes the outbound lease, or the arrival
    // beat has no lease to settle and the player is stranded at 0 forever,
    // invisible to their real sector and to everyone standing in it.
    const { store, advance, at } = makeStore();
    store.upsert({ name: 'rill', sector: 0, character: null });          // standing in the village
    assert.ok(store.startTravel('rill', 5, at() + 3_000));               // depart for wild sector 5
    advance(1_000);
    const midTravel = store.upsert({ name: 'rill', sector: 0, character: null }); // mask beat: still 0
    assert.equal(midTravel.sector, 0, 'still at the origin during the mask');
    assert.equal(midTravel.travelDestinationSector, 5, 'outbound lease is NOT wiped by the origin-0 beat');
    advance(2_100);
    const arrived = store.upsert({ name: 'rill', sector: 5, character: null }); // arrival beat
    assert.equal(arrived.sector, 5, 'arrives in the destination sector, visible to its peers');
    assert.deepEqual(store.listSector(5).map((p) => p.name), ['rill']);
    assert.equal(store.listSector(0).length, 0);
});

test('a stale origin-0 beat on the arrival boundary does not bounce the player home', () => {
    // Harder variant: the beat carrying the client's stale origin (0) lands at the
    // EXACT moment the lease matures. The store settles the trip to the destination
    // on that beat, so honoring the 0 would immediately bounce the just-arrived
    // player back to the safe zone and strand them. The lease-authoritative guard
    // must keep them at the destination.
    const { store, advance, at } = makeStore();
    store.upsert({ name: 'rill', sector: 0, character: null });
    assert.ok(store.startTravel('rill', 7, at() + 3_000));
    advance(3_000); // now === arrivalAt: the lease matures on this beat
    const arrived = store.upsert({ name: 'rill', sector: 0, character: null }); // still reporting origin 0
    assert.equal(arrived.sector, 7, 'settled destination wins over the stale origin-0 beat');
    assert.deepEqual(store.listSector(7).map((p) => p.name), ['rill']);
    assert.equal(store.listSector(0).length, 0);
});

test('a genuine safe-zone return (no active lease) still snaps to sector 0', () => {
    // The guard above must not weaken the normal safe-zone exit: a player standing
    // in a wild sector who walks back to the village (no outbound lease) still
    // moves to sector 0 on the next beat.
    const { store } = makeStore();
    store.upsert({ name: 'rill', sector: 5, character: null });
    const home = store.upsert({ name: 'rill', sector: 0, character: null });
    assert.equal(home.sector, 0, 'safe-zone exit still works without a lease');
});

test('validated edge travel reconciles a stale presence origin sector', () => {
    let now = 1_000;
    const store = new MemoryOnlineStateStore({ now: () => now });
    store.upsert({ name: 'rill', sector: 40, character: null, tile: 78 });

    const started = store.startTravel('rill', 10, now + 3_000, 55);
    assert.equal(started?.sector, 55);
    assert.equal(store.listSector(40).length, 0);
    assert.equal(store.listSector(55)[0]?.name, 'rill');

    now += 3_000;
    const arrived = store.upsert({ name: 'rill', sector: 10, character: null, tile: 67 });
    assert.equal(arrived.sector, 10);
    assert.equal(store.listSector(55).length, 0);
    assert.equal(store.listSector(10)[0]?.name, 'rill');
});

test('server-issued travel settles without a client-authored destination update', () => {
    const { store, advance, at } = makeStore();
    store.upsert({ name: 'rill', sector: 1, character: null, tile: 10 });
    assert.ok(store.startTravel('rill', 2, at() + 3_000, undefined, 55));
    advance(3_000);
    const settled = store.get('rill');
    assert.equal(settled?.sector, 2);
    assert.equal(settled?.tile, 55);
    assert.equal(settled?.travelingUntil, undefined);
    assert.equal(store.consumeSettledTravel('rill'), true);
    assert.equal(store.consumeSettledTravel('rill'), false, 'settlement signal is one-shot');
});

test('stale mid-travel disconnect is swept at its matured destination', () => {
    const { store, advance, at } = makeStore(60_000);
    store.upsert({ name: 'rill', sector: 1, character: null });
    assert.ok(store.startTravel('rill', 2, at() + 3_000));
    advance(60_001);
    const [removed] = store.sweepStale();
    assert.equal(removed?.sector, 2, 'sleeper materialization receives the destination');
    assert.equal(removed?.departureSector, 1, 'socket departure still targets the room that saw the player');
    assert.equal(removed?.travelingUntil, undefined);
});

test('moveToTile refreshes a player and increments movement sequence', () => {
    const { store } = makeStore();
    store.upsert({ name: 'rill', sector: 1, character: null, tile: 10 });
    const firstSequence = store.moveToTile('rill', 11)?.movementSeq;
    const second = store.moveToTile('rill', 12);
    assert.equal(firstSequence, 1);
    assert.equal(second?.movementSeq, 2);
    assert.equal(second?.tile, 12);
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
    assert.deepEqual(removed.map((p) => p.name), ['rill']);
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
