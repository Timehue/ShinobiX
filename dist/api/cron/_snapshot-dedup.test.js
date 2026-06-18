"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const node_assert_1 = require("node:assert");
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
