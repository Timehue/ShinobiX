import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { buildRestoredSave, restoreSnapshotUnderLock } from './save-snapshot.js';

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
        const store = {
            async get<T>(key: string) { return (data.get(key) ?? null) as T | null; },
            async set(key: string, value: unknown) { data.set(key, structuredClone(value)); return 'OK' as const; },
        };
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
        const store = {
            async get<T>(key: string) { return (data.get(key) ?? null) as T | null; },
            async set(key: string, value: unknown) { data.set(key, structuredClone(value)); return 'OK' as const; },
        };
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
});
