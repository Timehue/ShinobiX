"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const node_assert_1 = require("node:assert");
const _storage_js_1 = require("../_storage.js");
const snapshot_saves_js_1 = require("./snapshot-saves.js");
// Guards the snapshot-dedup bucketing that replaced the per-player kv.keys() N+1.
// The map must yield the SAME "newest snapshot ts per player" the old per-player
// reduce did, or the daily backup would either re-snapshot recently-saved players
// (wasted budget) or skip players it shouldn't (missed backups).
(0, node_test_1.describe)('newestSnapshotByPlayer — snapshot-dedup bucketing', () => {
    (0, node_test_1.it)('buckets the newest ts per player across many keys', () => {
        const m = (0, snapshot_saves_js_1.newestSnapshotByPlayer)([
            'save-snapshot:Alice:100',
            'save-snapshot:Alice:300', // newest for Alice
            'save-snapshot:Alice:200',
            'save-snapshot:Bob:50',
            'save-snapshot:Bob:75', // newest for Bob
        ]);
        node_assert_1.strict.equal(m.get('Alice'), 300);
        node_assert_1.strict.equal(m.get('Bob'), 75);
        node_assert_1.strict.equal(m.size, 2);
    });
    (0, node_test_1.it)('ignores malformed keys (no ts, NaN ts, no colon, empty name, ts<=0, wrong prefix)', () => {
        const m = (0, snapshot_saves_js_1.newestSnapshotByPlayer)([
            'save-snapshot:Alice', // no ts segment
            'save-snapshot:Alice:', // empty ts -> NaN
            'save-snapshot:Alice:abc', // non-numeric ts
            'save-snapshot::123', // empty name
            'save-snapshot:Alice:0', // ts <= 0
            'save:Alice:123', // wrong prefix
            'save-snapshot:Alice:500', // the only valid entry
        ]);
        node_assert_1.strict.equal(m.get('Alice'), 500);
        node_assert_1.strict.equal(m.size, 1);
    });
    (0, node_test_1.it)('handles names containing a colon (ts is always the last segment)', () => {
        const m = (0, snapshot_saves_js_1.newestSnapshotByPlayer)(['save-snapshot:clan:Hokage:900']);
        node_assert_1.strict.equal(m.get('clan:Hokage'), 900);
    });
    (0, node_test_1.it)('empty input -> empty map', () => {
        node_assert_1.strict.equal((0, snapshot_saves_js_1.newestSnapshotByPlayer)([]).size, 0);
    });
    (0, node_test_1.it)('matches a per-player max-ts reduce (parity with the replaced logic)', () => {
        const keys = ['save-snapshot:P:10', 'save-snapshot:P:40', 'save-snapshot:P:25', 'save-snapshot:Q:99'];
        const m = (0, snapshot_saves_js_1.newestSnapshotByPlayer)(keys);
        const oldNewestForP = keys
            .filter(k => k.startsWith('save-snapshot:P:'))
            .map(k => Number(k.slice('save-snapshot:P:'.length)))
            .reduce((a, b) => Math.max(a, b), 0);
        node_assert_1.strict.equal(m.get('P'), oldNewestForP); // 40
        node_assert_1.strict.equal(m.get('Q'), 99);
    });
});
(0, node_test_1.describe)('snapshot success marker freshness', () => {
    const now = Date.UTC(2026, 6, 10, 12);
    const marker = (completedAt) => ({
        completedAt,
        snapshotted: 1,
        skipped: 0,
        total: 1,
        elapsedMs: 10,
    });
    (0, node_test_1.it)('accepts a complete run inside the 26-hour recovery window', () => {
        node_assert_1.strict.equal((0, snapshot_saves_js_1.isSnapshotMarkerFresh)(marker(now - 25 * 60 * 60 * 1000), now), true);
    });
    (0, node_test_1.it)('rejects stale, future, missing, and malformed markers', () => {
        node_assert_1.strict.equal((0, snapshot_saves_js_1.isSnapshotMarkerFresh)(marker(now - 27 * 60 * 60 * 1000), now), false);
        node_assert_1.strict.equal((0, snapshot_saves_js_1.isSnapshotMarkerFresh)(marker(now + 1), now), false);
        node_assert_1.strict.equal((0, snapshot_saves_js_1.isSnapshotMarkerFresh)(null, now), false);
        node_assert_1.strict.equal((0, snapshot_saves_js_1.isSnapshotMarkerFresh)(marker(Number.NaN), now), false);
    });
});
(0, node_test_1.describe)('player snapshot key classification', () => {
    (0, node_test_1.it)('accepts real players (including the protected admin player) and rejects probes/shared rows', () => {
        node_assert_1.strict.equal((0, snapshot_saves_js_1.isPlayerSnapshotSaveKey)('save:alice'), true);
        node_assert_1.strict.equal((0, snapshot_saves_js_1.isPlayerSnapshotSaveKey)('save:Aka Ito'), true);
        node_assert_1.strict.equal((0, snapshot_saves_js_1.isPlayerSnapshotSaveKey)('save:Rill'), true);
        node_assert_1.strict.equal((0, snapshot_saves_js_1.isPlayerSnapshotSaveKey)('save:rill'), true);
        for (const key of ['save:Admin 1', 'save:admin201', 'save:clan-leaf', 'save:health-probe-123', 'save:', 'world:alice']) {
            node_assert_1.strict.equal((0, snapshot_saves_js_1.isPlayerSnapshotSaveKey)(key), false, key);
        }
    });
});
(0, node_test_1.describe)('snapshot run health', () => {
    (0, node_test_1.it)('does not publish a success marker when one valid save is mixed with a corrupt player row', async () => {
        const originalKeys = _storage_js_1.kv.keys;
        const originalGet = _storage_js_1.kv.get;
        const originalSet = _storage_js_1.kv.set;
        const records = new Map([
            ['save:valid-player', { character: { name: 'Valid Player', level: 10 } }],
            ['save:broken-player', { notCharacter: true }],
        ]);
        _storage_js_1.kv.keys = async (pattern) => pattern === 'save:*'
            ? ['save:valid-player', 'save:broken-player']
            : [];
        _storage_js_1.kv.get = async (key) => (records.get(key) ?? null);
        _storage_js_1.kv.set = async (key, value) => {
            records.set(key, value);
            return 'OK';
        };
        try {
            const result = await (0, snapshot_saves_js_1.runSnapshotSaves)(5_000);
            node_assert_1.strict.equal(result.ok, false);
            node_assert_1.strict.equal(result.validPlayers, 1);
            node_assert_1.strict.equal(result.snapshotted, 1);
            node_assert_1.strict.deepEqual(result.failed, ['save:broken-player']);
            node_assert_1.strict.equal(records.has(snapshot_saves_js_1.SNAPSHOT_SUCCESS_KEY), false);
        }
        finally {
            _storage_js_1.kv.keys = originalKeys;
            _storage_js_1.kv.get = originalGet;
            _storage_js_1.kv.set = originalSet;
        }
    });
});
