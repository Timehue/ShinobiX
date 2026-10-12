import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import handler, { buildRestoredSave, restoreSnapshotUnderLock, RestoreConflictError, snapshotValidUntil } from './save-snapshot.js';
import { _makeMemoryKv, kv } from '../_storage.js';

describe('buildRestoredSave', () => {
    it('restores at max(live, snapshot)+1 and stamps the restore time', () => {
        const out = buildRestoredSave(
            { _saveVersion: 12, character: { level: 8 } },
            { _saveVersion: 20, character: { level: 99 } },
            12345,
        );
        assert.equal(out._saveVersion, 21);
        assert.equal(out._saveAt, 12345);
        assert.deepEqual(out.character, { level: 8 });
    });

    it('rejects an invalid or exhausted stored version instead of rolling it back', () => {
        assert.throws(() => buildRestoredSave({ _saveVersion: -1 }, null, 1), /invalid/i);
        assert.throws(
            () => buildRestoredSave({ _saveVersion: Number.MAX_SAFE_INTEGER }, null, 1),
            /exhausted/i,
        );
    });
});

describe('restoreSnapshotUnderLock', () => {
    it('requests the shared save lock in fail-closed mode and signals reload', async () => {
        const data = new Map<string, unknown>([
            ['save:alice', { _saveVersion: 4, character: { ryo: 9 } }],
        ]);
        const seen: Array<{ target: string; failClosed: boolean }> = [];
        const store = mapStore(data);
        const lock = async <T>(target: string, fn: () => Promise<T>, opts: { failClosed: true }) => {
            seen.push({ target, failClosed: opts.failClosed });
            return fn();
        };

        const result = await restoreSnapshotUnderLock({
            playerName: 'Alice',
            saveKey: 'save:alice',
            snapshotKey: 'save-snapshot:Alice:100',
            snapshot: { _saveVersion: 2, character: { ryo: 3 } },
            store,
            lock,
            now: () => 200,
        });

        assert.deepEqual(seen, [{ target: 'save:alice', failClosed: true }]);
        assert.equal(result.restoredVersion, 5);
        assert.deepEqual(data.get('save:alice'), { _saveVersion: 5, _saveAt: 200, character: { ryo: 3 } });
        assert.equal(data.get('reset-signal:alice'), 1);
        assert.deepEqual(data.get('save-snapshot:Alice:200'), { _saveVersion: 4, character: { ryo: 9 } });
    });

    it('serializes behind a paused autosave so the restore wins with a newer version', async () => {
        const data = new Map<string, unknown>([
            ['save:alice', { _saveVersion: 5, character: { marker: 'live' } }],
        ]);
        const store = mapStore(data);
        let tail: Promise<unknown> = Promise.resolve();
        const lock = <T>(_target: string, fn: () => Promise<T>, _opts: { failClosed: true }): Promise<T> => {
            const run = tail.then(fn);
            tail = run.then(() => undefined, () => undefined);
            return run;
        };

        let releaseAutosave!: () => void;
        const autosavePaused = new Promise<void>((resolve) => { releaseAutosave = resolve; });
        let autosaveRead!: () => void;
        const readSignal = new Promise<void>((resolve) => { autosaveRead = resolve; });
        const autosave = lock('save:alice', async () => {
            const live = await store.get<Record<string, unknown>>('save:alice');
            autosaveRead();
            await autosavePaused;
            await store.set('save:alice', { ...live, _saveVersion: 6, character: { marker: 'stale-autosave' } });
        }, { failClosed: true });
        await readSignal;

        const restore = restoreSnapshotUnderLock({
            playerName: 'alice',
            saveKey: 'save:alice',
            snapshotKey: 'save-snapshot:alice:50',
            snapshot: { _saveVersion: 7, character: { marker: 'snapshot' } },
            store,
            lock,
            now: () => 100,
        });
        releaseAutosave();
        await Promise.all([autosave, restore]);

        assert.deepEqual(data.get('save:alice'), {
            _saveVersion: 8,
            _saveAt: 100,
            character: { marker: 'snapshot' },
        });
    });

    it('moves the currency ledger to the restored balances in the same commit', async () => {
        const store = _makeMemoryKv();
        await store.set('save:alice', { _saveVersion: 9, character: { createdAt: 1, ryo: 50, fateShards: 2 } });
        const unlocked = <T>(_target: string, fn: () => Promise<T>) => fn();
        await restoreSnapshotUnderLock({
            playerName: 'alice',
            saveKey: 'save:alice',
            snapshotKey: 'save-snapshot:alice:5',
            snapshot: { _saveVersion: 6, character: { createdAt: 1, ryo: 4_000, fateShards: 7 } },
            store,
            lock: unlocked,
            now: () => 300,
        });
        const ledger = await store.get<Record<string, unknown>>('ledger:currency:alice');
        assert.equal(ledger?.saveVersion, 10);
        assert.deepEqual(ledger?.balances, { ryo: 4_000, fateShards: 7 });
    });

    it('refuses, writing nothing, when the live save moved after the restore read it', async () => {
        const data = new Map<string, unknown>([['save:alice', { _saveVersion: 3, character: { marker: 'live' } }]]);
        const base = mapStore(data);
        const store = {
            ...base,
            // Another writer commits between the restore's read and its write,
            // as when the restore's lock lapsed on a stalled database.
            async compareSet(key: string, expected: unknown, value: unknown) {
                if (key === 'save:alice') data.set(key, { _saveVersion: 4, character: { marker: 'newer' } });
                return base.compareSet(key, expected, value);
            },
        };
        await assert.rejects(restoreSnapshotUnderLock({
            playerName: 'alice',
            saveKey: 'save:alice',
            snapshotKey: 'save-snapshot:alice:1',
            snapshot: { _saveVersion: 1, character: { marker: 'snapshot' } },
            store,
            lock: <T>(_target: string, fn: () => Promise<T>) => fn(),
            now: () => 400,
        }), RestoreConflictError);
        assert.deepEqual(data.get('save:alice'), { _saveVersion: 4, character: { marker: 'newer' } }, 'the newer commit survives');
        assert.equal(data.has('reset-signal:alice'), false);
    });
});

function mapStore(data: Map<string, unknown>) {
    return {
        async get<T>(key: string) { return (data.get(key) ?? null) as T | null; },
        async set(key: string, value: unknown) { data.set(key, structuredClone(value)); return 'OK' as const; },
        async compareSet(key: string, expected: unknown, value: unknown) {
            if (JSON.stringify(data.get(key) ?? null) !== JSON.stringify(expected ?? null)) return false;
            data.set(key, structuredClone(value));
            return true;
        },
    };
}

describe('snapshot validity (deduplicated nightly snapshots)', () => {
    const DAY = 24 * 60 * 60 * 1000;

    it('an older snapshot was current until the next one was taken', () => {
        assert.equal(snapshotValidUntil(100, [100, 500, 300], true, 9_999), 300);
    });

    it('the newest snapshot is current now while it equals the live save, else until its capture', () => {
        assert.equal(snapshotValidUntil(500, [100, 500], true, 9_999), 9_999);
        assert.equal(snapshotValidUntil(500, [100, 500], false, 9_999), 500);
    });

    function stubStore(records: Map<string, unknown>) {
        const original = { keys: kv.keys, get: kv.get, mget: kv.mget, set: kv.set };
        kv.keys = async (pattern: string) => [...records.keys()].filter((k) => k.startsWith(pattern.replace(/\*$/, '')));
        kv.get = async <T = unknown>(key: string) => (records.get(key) ?? null) as T | null;
        kv.mget = async (...keys: string[]) => keys.map((k) => records.get(k) ?? null) as never;
        // Hermetic: the age gate is under test, so the restore's lock write is refused.
        kv.set = async () => { throw new Error('stubbed store: writes refused'); };
        return () => Object.assign(kv, original);
    }

    function call(body: Record<string, unknown>) {
        const out: { status: number; body: any } = { status: 0, body: null };
        const res = {
            setHeader() { return res; },
            status(code: number) { out.status = code; return res; },
            json(payload: unknown) { out.body = payload; return res; },
            end() { return res; },
        };
        const req = { method: 'POST', headers: { 'x-admin-password': 'snapshot-test-admin' }, body };
        return Promise.resolve(handler(req as never, res as never)).then(() => out);
    }

    it('list reports when each state stopped being current, and the restore age check uses it', async () => {
        const now = Date.now();
        const firstTs = now - 60 * DAY;   // an idle player's first (and renewed) copy
        const olderTs = now - 90 * DAY + DAY;
        const live = { _saveVersion: 7, character: { name: 'Idle', level: 4 } };
        const records = new Map<string, unknown>([
            ['save:idle', live],
            [`save-snapshot:idle:${olderTs}`, { _saveVersion: 3, character: { name: 'Idle', level: 2 } }],
            // Same content as the live save, different key order.
            [`save-snapshot:idle:${firstTs}`, { character: { level: 4, name: 'Idle' }, _saveVersion: 7 }],
        ]);
        const restore = stubStore(records);
        const previousAdmin = process.env.ADMIN_PASSWORD;
        process.env.ADMIN_PASSWORD = 'snapshot-test-admin';
        try {
            const listed = await call({ action: 'list', playerName: 'idle' });
            assert.equal(listed.status, 200);
            const [newest, older] = listed.body.snapshots;
            assert.equal(newest.ts, firstTs);
            assert.equal(newest.matchesLive, true);
            assert.ok(newest.validUntil >= now, 'a 60-day-old key holding the live state is current, not 60 days stale');
            assert.equal(older.validUntil, firstTs);
            assert.equal('matchesLive' in older, false);

            // Restoring the live-equal newest copy passes the age gate (no confirmation)
            // and reaches the lock, which the stub refuses: proof it got past the gate.
            const fresh = await call({ action: 'restore', playerName: 'idle', snapshotKey: `save-snapshot:idle:${firstTs}` });
            assert.notEqual(fresh.status, 400, JSON.stringify(fresh.body));
            assert.doesNotMatch(JSON.stringify(fresh.body), /days old/);

            // The older state ended 60 days ago: still gated.
            const stale = await call({ action: 'restore', playerName: 'idle', snapshotKey: `save-snapshot:idle:${olderTs}` });
            assert.equal(stale.status, 400);
            assert.match(stale.body.error, /60 days old/);
        } finally {
            restore();
            if (previousAdmin === undefined) delete process.env.ADMIN_PASSWORD;
            else process.env.ADMIN_PASSWORD = previousAdmin;
        }
    });
});