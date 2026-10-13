import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { kv } from '../_storage.js';
import {
    __resetSnapshotRenewalsForTest,
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
        const m = newestSnapshotByPlayer(['save-snapshot:clan:Ashen:900']);
        assert.equal(m.get('clan:Ashen'), 900);
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

    it('renews an unchanged save\'s newest snapshot instead of copying it, and copies a changed one', async () => {
        const originalKeys = kv.keys;
        const originalGet = kv.get;
        const originalSet = kv.set;
        const originalCompareSet = kv.compareSet;
        const originalNow = Date.now;
        const now = 1_800_000_000_000;
        const dayAgo = now - 25 * 60 * 60 * 1000;
        // Same content, different key order: the store compares JSON structurally.
        const idle = { character: { name: 'Idle', level: 3 }, currentSector: 7 };
        const records = new Map<string, unknown>([
            ['save:idle', idle],
            [`save-snapshot:idle:${dayAgo}`, { currentSector: 7, character: { level: 3, name: 'Idle' } }],
            ['save:active', { character: { name: 'Active', level: 9 } }],
            [`save-snapshot:active:${dayAgo}`, { character: { name: 'Active', level: 8 } }],
        ]);
        const ttls = new Map<string, number | undefined>();
        const canonical = (v: unknown): string => JSON.stringify(v, (_k, val) => (
            val && typeof val === 'object' && !Array.isArray(val)
                ? Object.fromEntries(Object.entries(val).sort(([a], [b]) => a.localeCompare(b)))
                : val
        ));
        Date.now = () => now;
        kv.keys = async (pattern: string) => {
            const prefix = pattern.replace(/\*$/, '');
            return [...records.keys()].filter((key) => key.startsWith(prefix));
        };
        kv.get = async <T = unknown>(key: string) => (records.get(key) ?? null) as T | null;
        kv.set = async (key: string, value: unknown, options?: { ex?: number }) => {
            records.set(key, value);
            ttls.set(key, options?.ex);
            return 'OK' as const;
        };
        kv.compareSet = async (key: string, expected: unknown, value: unknown, options?: { ex?: number }) => {
            if (!records.has(key) || canonical(records.get(key)) !== canonical(expected)) return false;
            records.set(key, value);
            ttls.set(key, options?.ex);
            return true;
        };

        try {
            const result = await runSnapshotSaves(5_000);
            assert.equal(result.ok, true);
            assert.equal(result.snapshotted, 1, 'only the changed save is copied');
            assert.equal(result.unchanged, 1);
            assert.equal(result.skipped, 1);
            const snapshotKeys = [...records.keys()].filter((key) => key.startsWith('save-snapshot:'));
            assert.deepEqual(snapshotKeys.filter((key) => key.startsWith('save-snapshot:idle:')), [`save-snapshot:idle:${dayAgo}`]);
            assert.equal(ttls.get(`save-snapshot:idle:${dayAgo}`), 90 * 24 * 60 * 60, 'the kept copy gets a fresh 90-day TTL');
            assert.deepEqual(
                snapshotKeys.filter((key) => key.startsWith('save-snapshot:active:')).sort(),
                [`save-snapshot:active:${dayAgo}`, `save-snapshot:active:${now}`],
            );
            assert.deepEqual(records.get(`save-snapshot:active:${now}`), { character: { name: 'Active', level: 9 } });
        } finally {
            Date.now = originalNow;
            kv.keys = originalKeys;
            kv.get = originalGet;
            kv.set = originalSet;
            kv.compareSet = originalCompareSet;
        }
    });

    it('a same-day re-run does not rewrite unchanged snapshots again, but still captures a changed save', async () => {
        __resetSnapshotRenewalsForTest();
        const originalKeys = kv.keys;
        const originalGet = kv.get;
        const originalSet = kv.set;
        const originalCompareSet = kv.compareSet;
        const originalNow = Date.now;
        let now = 1_800_000_000_000;
        const dayAgo = now - 25 * 60 * 60 * 1000;
        const records = new Map<string, unknown>([
            ['save:idle', { character: { name: 'Idle', level: 3 } }],
            [`save-snapshot:idle:${dayAgo}`, { character: { name: 'Idle', level: 3 } }],
            ['save:later', { character: { name: 'Later', level: 5 } }],
            [`save-snapshot:later:${dayAgo}`, { character: { name: 'Later', level: 5 } }],
        ]);
        let renewals = 0;
        let copies = 0;
        Date.now = () => now;
        kv.keys = async (pattern: string) => {
            const prefix = pattern.replace(/\*$/, '');
            return [...records.keys()].filter((key) => key.startsWith(prefix));
        };
        kv.get = async <T = unknown>(key: string) => (records.get(key) ?? null) as T | null;
        kv.set = async (key: string, value: unknown) => {
            records.set(key, value);
            if (key.startsWith('save-snapshot:')) copies += 1;
            return 'OK' as const;
        };
        kv.compareSet = async (key: string, expected: unknown, value: unknown) => {
            if (JSON.stringify(records.get(key)) !== JSON.stringify(expected)) return false;
            records.set(key, value);
            renewals += 1;
            return true;
        };
        try {
            const first = await runSnapshotSaves(5_000);
            assert.equal(first.unchanged, 2);
            assert.equal(renewals, 2);

            // The recovery retry loop or a manual trigger runs again an hour later.
            now += 60 * 60 * 1000;
            records.set('save:later', { character: { name: 'Later', level: 6 } });
            const rerun = await runSnapshotSaves(5_000);
            assert.equal(renewals, 2, 'an unchanged save is not rewritten a second time the same day');
            assert.equal(rerun.unchanged, 1);
            assert.equal(copies, 1, 'the save that changed is still captured');
            assert.equal(rerun.snapshotted, 1);
        } finally {
            Date.now = originalNow;
            kv.keys = originalKeys;
            kv.get = originalGet;
            kv.set = originalSet;
            kv.compareSet = originalCompareSet;
            __resetSnapshotRenewalsForTest();
        }
    });

    it('a quiet night with one transient failure is not reported as a snapshot-store outage', async () => {
        __resetSnapshotRenewalsForTest();
        const originalKeys = kv.keys;
        const originalGet = kv.get;
        const originalCompareSet = kv.compareSet;
        const originalNow = Date.now;
        const now = 1_800_000_000_000;
        const dayAgo = now - 25 * 60 * 60 * 1000;
        const records = new Map<string, unknown>([
            ['save:quiet', { character: { name: 'Quiet', level: 3 } }],
            [`save-snapshot:quiet:${dayAgo}`, { character: { name: 'Quiet', level: 3 } }],
            ['save:broken', { notCharacter: true }],
        ]);
        Date.now = () => now;
        kv.keys = async (pattern: string) => {
            const prefix = pattern.replace(/\*$/, '');
            return [...records.keys()].filter((key) => key.startsWith(prefix));
        };
        kv.get = async <T = unknown>(key: string) => (records.get(key) ?? null) as T | null;
        kv.compareSet = async () => true;
        const error = console.error;
        console.error = () => undefined;
        try {
            const result = await runSnapshotSaves(5_000);
            assert.equal(result.unchanged, 1);
            assert.equal(result.snapshotted, 0);
            assert.equal(result.writeOutage, false, 'a renewal is a successful write');
        } finally {
            console.error = error;
            Date.now = originalNow;
            kv.keys = originalKeys;
            kv.get = originalGet;
            kv.compareSet = originalCompareSet;
            __resetSnapshotRenewalsForTest();
        }
    });

    it('a re-run whose only real write fails IS an outage; read-only skips prove nothing', async () => {
        __resetSnapshotRenewalsForTest();
        const originalKeys = kv.keys;
        const originalGet = kv.get;
        const originalSet = kv.set;
        const originalCompareSet = kv.compareSet;
        const originalNow = Date.now;
        let now = 1_800_000_000_000;
        const dayAgo = now - 25 * 60 * 60 * 1000;
        const records = new Map<string, unknown>([
            ['save:idle', { character: { name: 'Idle', level: 3 } }],
            [`save-snapshot:idle:${dayAgo}`, { character: { name: 'Idle', level: 3 } }],
            ['save:later', { character: { name: 'Later', level: 5 } }],
            [`save-snapshot:later:${dayAgo}`, { character: { name: 'Later', level: 5 } }],
        ]);
        let storeDown = false;
        Date.now = () => now;
        kv.keys = async (pattern: string) => {
            const prefix = pattern.replace(/\*$/, '');
            return [...records.keys()].filter((key) => key.startsWith(prefix));
        };
        kv.get = async <T = unknown>(key: string) => (records.get(key) ?? null) as T | null;
        kv.set = async (key: string, value: unknown) => {
            if (storeDown) throw new Error('snapshot store down');
            records.set(key, value);
            return 'OK' as const;
        };
        kv.compareSet = async (key: string, expected: unknown, value: unknown) => {
            if (storeDown) throw new Error('snapshot store down');
            if (JSON.stringify(records.get(key)) !== JSON.stringify(expected)) return false;
            records.set(key, value);
            return true;
        };
        const error = console.error;
        console.error = () => undefined;
        try {
            await runSnapshotSaves(5_000);
            now += 60 * 60 * 1000;
            storeDown = true;
            records.set('save:later', { character: { name: 'Later', level: 6 } });
            const rerun = await runSnapshotSaves(5_000);
            assert.equal(rerun.unchanged, 1, 'idle was skipped by a read');
            assert.equal(rerun.failed.length, 1);
            assert.equal(rerun.writeOutage, true, 'the one write attempted failed');
        } finally {
            console.error = error;
            Date.now = originalNow;
            kv.keys = originalKeys;
            kv.get = originalGet;
            kv.set = originalSet;
            kv.compareSet = originalCompareSet;
            __resetSnapshotRenewalsForTest();
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
