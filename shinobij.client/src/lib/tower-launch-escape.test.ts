import { strict as assert } from 'node:assert';
import test from 'node:test';
import {
    LAUNCH_ESCAPE_STORAGE_KEY,
    LAUNCH_TRANSITION_ESCAPE_MS,
    launchEscapeOpen,
    resolveLaunchStuckSince,
    type EscapeClockStore,
} from './tower-launch-escape';

function memoryStore(seed: Record<string, string> = {}): EscapeClockStore & { data: Record<string, string> } {
    const data = { ...seed };
    return {
        data,
        getItem: (k) => (k in data ? data[k] : null),
        setItem: (k, v) => { data[k] = v; },
    };
}

const stamp = (key: string, since: number) => ({ [LAUNCH_ESCAPE_STORAGE_KEY]: JSON.stringify({ key, since }) });

test('nothing stuck means no anchor and no escape', () => {
    const store = memoryStore();
    assert.equal(resolveLaunchStuckSince(null, 1_000, store), null);
    assert.equal(launchEscapeOpen(null, 10_000_000), false);
    assert.deepEqual(store.data, {}, 'a healthy room must not write a stamp');
});

test('the first sighting is recorded and reused', () => {
    const store = memoryStore();
    const first = resolveLaunchStuckSince('party-1:launching', 1_000, store);
    assert.equal(first, 1_000);
    // A later render (or a reload) must NOT restart the window.
    assert.equal(resolveLaunchStuckSince('party-1:launching', 55_000, store), 1_000);
});

test('a reload part-way through does not owe a fresh window', () => {
    // Stuck since t=0; the player reloads at t=50s. A purely in-memory anchor
    // would restart here and charge them another 60s.
    const store = memoryStore(stamp('party-1:launching', 0));
    const since = resolveLaunchStuckSince('party-1:launching', 50_000, store);
    assert.equal(since, 0);
    assert.equal(launchEscapeOpen(since, 61_000), true, 'the window must continue across the reload');
});

test('re-entering the same status later starts a fresh window', () => {
    // launching -> active -> launching again. The second launching is a NEW
    // transition and must not inherit the first one's stamp.
    const store = memoryStore(stamp('party-1:launching', 0));
    const active = resolveLaunchStuckSince('party-1:active', 90_000, store);
    assert.equal(active, 90_000);
    const relaunch = resolveLaunchStuckSince('party-1:launching', 120_000, store);
    assert.equal(relaunch, 120_000, 'the stale launching stamp must have been overwritten');
    assert.equal(launchEscapeOpen(relaunch, 130_000), false);
});

test('a different party never inherits another party stamp', () => {
    const store = memoryStore(stamp('party-1:launching', 0));
    assert.equal(resolveLaunchStuckSince('party-2:launching', 5_000, store), 5_000);
});

test('a stamp from the future is discarded rather than opening the hatch', () => {
    // Clock moved backwards (NTP correction, manual change).
    const store = memoryStore(stamp('party-1:launching', 9_000_000));
    assert.equal(resolveLaunchStuckSince('party-1:launching', 1_000, store), 1_000);
});

test('corrupt or unavailable storage still yields a usable in-memory anchor', () => {
    const corrupt = memoryStore({ [LAUNCH_ESCAPE_STORAGE_KEY]: 'not json{' });
    assert.equal(resolveLaunchStuckSince('party-1:launching', 7_000, corrupt), 7_000);

    const hostile: EscapeClockStore = {
        getItem: () => { throw new Error('storage disabled'); },
        setItem: () => { throw new Error('storage disabled'); },
    };
    assert.equal(resolveLaunchStuckSince('party-1:launching', 7_000, hostile), 7_000);
    assert.equal(resolveLaunchStuckSince('party-1:launching', 7_000, null), 7_000);
});

test('the escape opens only after the full window, not on the boundary', () => {
    assert.equal(launchEscapeOpen(0, LAUNCH_TRANSITION_ESCAPE_MS), false);
    assert.equal(launchEscapeOpen(null, LAUNCH_TRANSITION_ESCAPE_MS + 1), false);
    assert.equal(launchEscapeOpen(0, LAUNCH_TRANSITION_ESCAPE_MS + 1), true);
});

test('elapsed is measured on one clock, so server skew cannot open or block it', () => {
    // The regression this replaced: anchoring on a server `updatedAt` while
    // comparing against Date.now(). Here both sides come from the same clock,
    // so a client running minutes fast or slow behaves identically.
    for (const skew of [-600_000, 0, 600_000]) {
        const store = memoryStore();
        const t0 = 1_000_000 + skew;
        const since = resolveLaunchStuckSince('party-1:launching', t0, store);
        assert.equal(launchEscapeOpen(since, t0 + 30_000), false, `skew ${skew} opened early`);
        assert.equal(launchEscapeOpen(since, t0 + 61_000), true, `skew ${skew} never opened`);
    }
});
