import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { REINDEX_MIN_INTERVAL_MS, __resetRegistryReindexForTest, reindexPublicPlayer } from './_registry-reindex.js';
import { buildPublicPlayerIndexEntry } from './_public-index.js';

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

test('players are throttled independently', () => {
    const store = fakeStore();
    void reindexPublicPlayer(store, 'player:registry', 'rin', entry(1), { urgent: false, now: 1_000 });
    void reindexPublicPlayer(store, 'player:registry', 'kai', entry(1), { urgent: false, now: 1_000 });
    assert.equal(store.writes.length, 2);
});
