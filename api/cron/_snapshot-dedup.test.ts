import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { isPlayerSnapshotSaveKey, isSnapshotMarkerFresh, newestSnapshotByPlayer } from './snapshot-saves.js';

// Guards the snapshot-dedup bucketing that replaced the per-player kv.keys() N+1.
// The map must yield the SAME "newest snapshot ts per player" the old per-player
// reduce did, or the daily backup would either re-snapshot recently-saved players
// (wasted budget) or skip players it shouldn't (missed backups).
describe('newestSnapshotByPlayer — snapshot-dedup bucketing', () => {
    it('buckets the newest ts per player across many keys', () => {
        const m = newestSnapshotByPlayer([
            'save-snapshot:Alice:100',
            'save-snapshot:Alice:300', // newest for Alice
            'save-snapshot:Alice:200',
            'save-snapshot:Bob:50',
            'save-snapshot:Bob:75', // newest for Bob
        ]);
        assert.equal(m.get('Alice'), 300);
        assert.equal(m.get('Bob'), 75);
        assert.equal(m.size, 2);
    });

    it('ignores malformed keys (no ts, NaN ts, no colon, empty name, ts<=0, wrong prefix)', () => {
        const m = newestSnapshotByPlayer([
            'save-snapshot:Alice', // no ts segment
            'save-snapshot:Alice:', // empty ts -> NaN
            'save-snapshot:Alice:abc', // non-numeric ts
            'save-snapshot::123', // empty name
            'save-snapshot:Alice:0', // ts <= 0
            'save:Alice:123', // wrong prefix
            'save-snapshot:Alice:500', // the only valid entry
        ]);
        assert.equal(m.get('Alice'), 500);
        assert.equal(m.size, 1);
    });

    it('handles names containing a colon (ts is always the last segment)', () => {
        const m = newestSnapshotByPlayer(['save-snapshot:clan:Hokage:900']);
        assert.equal(m.get('clan:Hokage'), 900);
    });

    it('empty input -> empty map', () => {
        assert.equal(newestSnapshotByPlayer([]).size, 0);
    });

    it('matches a per-player max-ts reduce (parity with the replaced logic)', () => {
        const keys = ['save-snapshot:P:10', 'save-snapshot:P:40', 'save-snapshot:P:25', 'save-snapshot:Q:99'];
        const m = newestSnapshotByPlayer(keys);
        const oldNewestForP = keys
            .filter(k => k.startsWith('save-snapshot:P:'))
            .map(k => Number(k.slice('save-snapshot:P:'.length)))
            .reduce((a, b) => Math.max(a, b), 0);
        assert.equal(m.get('P'), oldNewestForP); // 40
        assert.equal(m.get('Q'), 99);
    });
});

describe('snapshot success marker freshness', () => {
    const now = Date.UTC(2026, 6, 10, 12);
    const marker = (completedAt: number) => ({
        completedAt,
        snapshotted: 1,
        skipped: 0,
        total: 1,
        elapsedMs: 10,
    });

    it('accepts a complete run inside the 26-hour recovery window', () => {
        assert.equal(isSnapshotMarkerFresh(marker(now - 25 * 60 * 60 * 1000), now), true);
    });

    it('rejects stale, future, missing, and malformed markers', () => {
        assert.equal(isSnapshotMarkerFresh(marker(now - 27 * 60 * 60 * 1000), now), false);
        assert.equal(isSnapshotMarkerFresh(marker(now + 1), now), false);
        assert.equal(isSnapshotMarkerFresh(null, now), false);
        assert.equal(isSnapshotMarkerFresh(marker(Number.NaN), now), false);
    });
});

describe('player snapshot key classification', () => {
    it('accepts players and rejects case-varied admin, protected, clan, and malformed rows', () => {
        assert.equal(isPlayerSnapshotSaveKey('save:alice'), true);
        assert.equal(isPlayerSnapshotSaveKey('save:Aka Ito'), true);
        for (const key of ['save:Admin 1', 'save:admin201', 'save:Rill', 'save:rill', 'save:clan-leaf', 'save:', 'world:alice']) {
            assert.equal(isPlayerSnapshotSaveKey(key), false, key);
        }
    });
});
