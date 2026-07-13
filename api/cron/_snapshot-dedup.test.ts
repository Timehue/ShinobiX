import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { kv } from '../_storage.js';
import {
    isPlayerSnapshotSaveKey,
    isSnapshotMarkerFresh,
    newestSnapshotByPlayer,
    runSnapshotSaves,
    SNAPSHOT_SUCCESS_KEY,
} from './snapshot-saves.js';

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
    it('accepts real players (including the protected admin player) and rejects probes/shared rows', () => {
        assert.equal(isPlayerSnapshotSaveKey('save:alice'), true);
        assert.equal(isPlayerSnapshotSaveKey('save:Aka Ito'), true);
        assert.equal(isPlayerSnapshotSaveKey('save:Rill'), true);
        assert.equal(isPlayerSnapshotSaveKey('save:rill'), true);
        for (const key of ['save:Admin 1', 'save:admin201', 'save:clan-leaf', 'save:health-probe-123', 'save:', 'world:alice']) {
            assert.equal(isPlayerSnapshotSaveKey(key), false, key);
        }
    });
});

describe('snapshot run health', () => {
    it('does not publish a success marker when one valid save is mixed with a corrupt player row', async () => {
        const originalKeys = kv.keys;
        const originalGet = kv.get;
        const originalSet = kv.set;
        const records = new Map<string, unknown>([
            ['save:valid-player', { character: { name: 'Valid Player', level: 10 } }],
            ['save:broken-player', { notCharacter: true }],
        ]);

        kv.keys = async (pattern: string) => pattern === 'save:*'
            ? ['save:valid-player', 'save:broken-player']
            : [];
        kv.get = async <T = unknown>(key: string) => (records.get(key) ?? null) as T | null;
        kv.set = async (key: string, value: unknown) => {
            records.set(key, value);
            return 'OK' as const;
        };

        try {
            const result = await runSnapshotSaves(5_000);
            assert.equal(result.ok, false);
            assert.equal(result.validPlayers, 1);
            assert.equal(result.snapshotted, 1);
            assert.deepEqual(result.failed, ['save:broken-player']);
            assert.equal(records.has(SNAPSHOT_SUCCESS_KEY), false);
        } finally {
            kv.keys = originalKeys;
            kv.get = originalGet;
            kv.set = originalSet;
        }
    });

    it('recovers an interrupted run without duplicating completed snapshots', async () => {
        const originalKeys = kv.keys;
        const originalGet = kv.get;
        const originalSet = kv.set;
        const originalNow = Date.now;
        const records = new Map<string, unknown>();
        for (let index = 1; index <= 9; index += 1) {
            records.set(`save:recovery-${index}`, { character: { name: `Recovery ${index}`, level: index } });
        }
        let now = 1_800_000_000_000;
        let snapshotWrites = 0;
        Date.now = () => now;
        kv.keys = async (pattern: string) => {
            if (pattern === 'save:*') return [...records.keys()].filter((key) => key.startsWith('save:'));
            if (pattern === 'save-snapshot:*') return [...records.keys()].filter((key) => key.startsWith('save-snapshot:'));
            return [];
        };
        kv.get = async <T = unknown>(key: string) => (records.get(key) ?? null) as T | null;
        kv.set = async (key: string, value: unknown) => {
            records.set(key, value);
            if (key.startsWith('save-snapshot:')) {
                snapshotWrites += 1;
                if (snapshotWrites === 8) now += 101;
            }
            return 'OK' as const;
        };

        try {
            const interrupted = await runSnapshotSaves(100);
            assert.equal(interrupted.ok, false);
            assert.equal(interrupted.truncated, true);
            assert.equal(interrupted.processed, 8);
            assert.equal(interrupted.snapshotted, 8);
            assert.equal(records.has(SNAPSHOT_SUCCESS_KEY), false);

            now += 1_000;
            const recovered = await runSnapshotSaves(5_000);
            assert.equal(recovered.ok, true);
            assert.equal(recovered.truncated, false);
            assert.equal(recovered.processed, 9);
            assert.equal(recovered.skipped, 8);
            assert.equal(recovered.snapshotted, 1);
            assert.equal(snapshotWrites, 9, 'retry must not rewrite the first completed batch');
            assert.equal(records.has(SNAPSHOT_SUCCESS_KEY), true);
        } finally {
            Date.now = originalNow;
            kv.keys = originalKeys;
            kv.get = originalGet;
            kv.set = originalSet;
        }
    });
});
