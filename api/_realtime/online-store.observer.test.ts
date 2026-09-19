import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MemoryOnlineStateStore } from './online-store.js';
import type { PresenceStoreEvent } from './types.js';

// The store reports the changes sector-mates can see but no request handler
// witnesses: a trip maturing on whichever read notices it, a fight host
// flipping inBattle, an admin removal, a restored boot row coming back
// elsewhere. presence-broadcast.ts turns these into socket frames.

function observed(now: () => number, offlineAfterMs = 90_000) {
    const store = new MemoryOnlineStateStore({ now, offlineAfterMs });
    const events: PresenceStoreEvent[] = [];
    store.setObserver((event) => events.push(event));
    return { store, events };
}

test('a trip that matures on a plain read is reported as a move, exactly once', () => {
    let t = 1_000;
    const { store, events } = observed(() => t);
    store.upsert({ name: 'Road Runner', sector: 12, character: null });
    assert.ok(store.startTravel('Road Runner', 13, t + 3_000));
    assert.deepEqual(events, [], 'a trip in flight is not a move');
    t += 3_000;
    assert.equal(store.get('roadrunner')?.sector, 13);
    store.get('roadrunner');
    store.list();
    assert.deepEqual(events, [{ type: 'moved', name: 'roadrunner', from: 12, to: 13 }]);
});

test('an instant edge crossing and an origin correction are both reported', () => {
    const t = 5_000;
    const { store, events } = observed(() => t);
    store.upsert({ name: 'edge', sector: 12, character: null });
    // The lease names a different origin and has already matured.
    assert.ok(store.startTravel('edge', 14, t - 1, 11));
    assert.deepEqual(events, [
        { type: 'moved', name: 'edge', from: 12, to: 11 },
        { type: 'moved', name: 'edge', from: 11, to: 14 },
    ]);
});

test('inBattle flips are reported only when the value changes', () => {
    const { store, events } = observed(() => 1_000);
    store.upsert({ name: 'fighter', sector: 20, character: null });
    store.setInBattle('Fighter', true);
    store.setInBattle('fighter', true);
    store.setInBattle('fighter', false);
    store.setInBattle('fighter', false);
    store.setInBattle('nobody', true);
    assert.deepEqual(events, [
        { type: 'changed', name: 'fighter', sector: 20 },
        { type: 'changed', name: 'fighter', sector: 20 },
    ]);
});

test('a removal (admin kick or ban) is reported with the sector it left', () => {
    const { store, events } = observed(() => 1_000);
    store.upsert({ name: 'Kicked One', sector: 33, character: null });
    store.remove('Kicked One');
    store.remove('Kicked One');
    assert.deepEqual(events, [{ type: 'removed', name: 'kickedone', sector: 33 }]);
});

test('a restored boot row whose owner returns elsewhere is a move out of the snapshot sector', () => {
    const t = 50_000;
    const { store, events } = observed(() => t);
    store.restore([{ name: 'sleeper', displayName: 'Sleeper', sector: 12, lastSeenAt: t - 1_000, connectedAt: t - 9_000 }]);
    // get() hides an unverified row, so no caller could have announced it.
    assert.equal(store.get('sleeper'), null);
    store.upsert({ name: 'Sleeper', sector: 18, character: null });
    assert.deepEqual(events, [{ type: 'moved', name: 'sleeper', from: 12, to: 18 }]);
});

test('a safe-zone exit is a move to sector 0; a same-sector beat is nothing', () => {
    const { store, events } = observed(() => 1_000);
    store.upsert({ name: 'walker', sector: 7, character: null });
    store.upsert({ name: 'walker', sector: 7, character: { level: 3 } });
    store.upsert({ name: 'walker', sector: 0, character: null });
    assert.deepEqual(events, [{ type: 'moved', name: 'walker', from: 7, to: 0 }]);
});

test('the sweep settles silently: its own onSweep announces the departure', () => {
    let t = 1_000;
    const { store, events } = observed(() => t, 60_000);
    store.upsert({ name: 'faded', sector: 12, character: null });
    assert.ok(store.startTravel('faded', 13, t + 1_000));
    t += 61_000;
    const removed = store.sweepStale();
    assert.equal(removed.length, 1);
    assert.equal(removed[0].sector, 13);
    assert.equal(removed[0].departureSector, 12);
    assert.deepEqual(events, []);
});

test('a throwing observer never reaches the read that triggered it', () => {
    let t = 1_000;
    const store = new MemoryOnlineStateStore({ now: () => t });
    store.setObserver(() => { throw new Error('listener fault'); });
    const original = console.error;
    console.error = () => undefined;
    try {
        store.upsert({ name: 'safe', sector: 12, character: null });
        assert.ok(store.startTravel('safe', 13, t + 10));
        t += 10;
        assert.equal(store.get('safe')?.sector, 13);
        store.setInBattle('safe', true);
        store.remove('safe');
    } finally {
        console.error = original;
    }
});

test('clearing the observer stops reports', () => {
    const { store, events } = observed(() => 1_000);
    store.setObserver(null);
    store.upsert({ name: 'quiet', sector: 12, character: null });
    store.setInBattle('quiet', true);
    store.remove('quiet');
    assert.deepEqual(events, []);
});
