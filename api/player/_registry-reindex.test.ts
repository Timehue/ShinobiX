import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { REINDEX_MIN_INTERVAL_MS, __resetRegistryReindexForTest, reindexPublicPlayer } from './_registry-reindex.js';
import { buildPublicPlayerIndexEntry } from './_public-index.js';
import { currentKvLockContext, withKvLeaseContext } from '../_kv-lock-context.js';

afterEach(() => { __resetRegistryReindexForTest(); });

function fakeStore() {
    const writes: Array<Record<string, unknown>> = [];
    return { writes, hset: async (_key: string, fields: Record<string, unknown>) => { writes.push(fields); return 1; } };
}
const entry = (unspentStats: number) => buildPublicPlayerIndexEntry({ name: 'Rin', stats: { strength: 20 }, unspentStats }, 'rin');

test('frequent server grants rewrite the shared registry row at most once a minute, and the latest still lands', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const store = fakeStore();
    void reindexPublicPlayer(store, 'player:registry', 'rin', entry(1), { urgent: false, now: 1_000 });
    for (let i = 2; i <= 10; i += 1) {
        void reindexPublicPlayer(store, 'player:registry', 'rin', entry(i), { urgent: false, now: 1_000 + i * 1_000 });
    }
    assert.equal(store.writes.length, 1, 'ten grants in ten seconds: one immediate write');
    t.mock.timers.tick(REINDEX_MIN_INTERVAL_MS);
    assert.equal(store.writes.length, 2, 'one trailing write at the end of the window');
    const flushed = store.writes[1].rin as { xp: number };
    assert.equal(flushed.xp, entry(10).xp, 'the trailing write carries the newest entry');
});

test('ranking-critical changes (urgent) are never deferred', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const store = fakeStore();
    void reindexPublicPlayer(store, 'player:registry', 'rin', entry(1), { urgent: false, now: 1_000 });
    void reindexPublicPlayer(store, 'player:registry', 'rin', entry(2), { urgent: true, now: 2_000 });
    assert.equal(store.writes.length, 2);
    t.mock.timers.tick(REINDEX_MIN_INTERVAL_MS);
    assert.equal(store.writes.length, 2, 'an urgent write also cancels the pending deferred one');
});

// Real timers on purpose: a mocked tick runs the callback in the ticker's
// context, so it cannot show which async context the timer itself inherited.
test('the deferred write does not inherit the caller\'s storage lock', async () => {
    const contexts: unknown[] = [];
    const store = { hset: async () => { contexts.push(currentKvLockContext()); return 1; } };
    const start = Date.now();
    await withKvLeaseContext('lock:save:rin', 'owner-1', async () => {
        await reindexPublicPlayer(store, 'player:registry', 'rin', entry(1), { urgent: false, now: start - REINDEX_MIN_INTERVAL_MS + 5 });
        await reindexPublicPlayer(store, 'player:registry', 'rin', entry(2), { urgent: false, now: start });
    });
    // The save lock is released here, long before the deferred write fires.
    await new Promise((resolve) => setTimeout(resolve, 60));
    assert.equal(contexts.length, 2, 'the immediate write and the deferred one');
    assert.notEqual(contexts[0], undefined, 'the immediate write runs inside the caller lock');
    assert.equal(contexts[1], undefined, 'the deferred write must not carry the released lease');
});

test('players are throttled independently', () => {
    const store = fakeStore();
    void reindexPublicPlayer(store, 'player:registry', 'rin', entry(1), { urgent: false, now: 1_000 });
    void reindexPublicPlayer(store, 'player:registry', 'kai', entry(1), { urgent: false, now: 1_000 });
    assert.equal(store.writes.length, 2);
});
