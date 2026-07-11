"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const node_assert_1 = require("node:assert");
const save_snapshot_js_1 = require("./save-snapshot.js");
(0, node_test_1.describe)('buildRestoredSave', () => {
    (0, node_test_1.it)('restores at max(live, snapshot)+1 and stamps the restore time', () => {
        const out = (0, save_snapshot_js_1.buildRestoredSave)({ _saveVersion: 12, character: { level: 8 } }, { _saveVersion: 20, character: { level: 99 } }, 12345);
        node_assert_1.strict.equal(out._saveVersion, 21);
        node_assert_1.strict.equal(out._saveAt, 12345);
        node_assert_1.strict.deepEqual(out.character, { level: 8 });
    });
    (0, node_test_1.it)('rejects an invalid or exhausted stored version instead of rolling it back', () => {
        node_assert_1.strict.throws(() => (0, save_snapshot_js_1.buildRestoredSave)({ _saveVersion: -1 }, null, 1), /invalid/i);
        node_assert_1.strict.throws(() => (0, save_snapshot_js_1.buildRestoredSave)({ _saveVersion: Number.MAX_SAFE_INTEGER }, null, 1), /exhausted/i);
    });
});
(0, node_test_1.describe)('restoreSnapshotUnderLock', () => {
    (0, node_test_1.it)('requests the shared save lock in fail-closed mode and signals reload', async () => {
        const data = new Map([
            ['save:alice', { _saveVersion: 4, character: { ryo: 9 } }],
        ]);
        const seen = [];
        const store = {
            async get(key) { return (data.get(key) ?? null); },
            async set(key, value) { data.set(key, structuredClone(value)); return 'OK'; },
        };
        const lock = async (target, fn, opts) => {
            seen.push({ target, failClosed: opts.failClosed });
            return fn();
        };
        const result = await (0, save_snapshot_js_1.restoreSnapshotUnderLock)({
            playerName: 'Alice',
            saveKey: 'save:alice',
            snapshotKey: 'save-snapshot:Alice:100',
            snapshot: { _saveVersion: 2, character: { ryo: 3 } },
            store,
            lock,
            now: () => 200,
        });
        node_assert_1.strict.deepEqual(seen, [{ target: 'save:alice', failClosed: true }]);
        node_assert_1.strict.equal(result.restoredVersion, 5);
        node_assert_1.strict.deepEqual(data.get('save:alice'), { _saveVersion: 5, _saveAt: 200, character: { ryo: 3 } });
        node_assert_1.strict.equal(data.get('reset-signal:alice'), 1);
        node_assert_1.strict.deepEqual(data.get('save-snapshot:Alice:200'), { _saveVersion: 4, character: { ryo: 9 } });
    });
    (0, node_test_1.it)('serializes behind a paused autosave so the restore wins with a newer version', async () => {
        const data = new Map([
            ['save:alice', { _saveVersion: 5, character: { marker: 'live' } }],
        ]);
        const store = {
            async get(key) { return (data.get(key) ?? null); },
            async set(key, value) { data.set(key, structuredClone(value)); return 'OK'; },
        };
        let tail = Promise.resolve();
        const lock = (_target, fn, _opts) => {
            const run = tail.then(fn);
            tail = run.then(() => undefined, () => undefined);
            return run;
        };
        let releaseAutosave;
        const autosavePaused = new Promise((resolve) => { releaseAutosave = resolve; });
        let autosaveRead;
        const readSignal = new Promise((resolve) => { autosaveRead = resolve; });
        const autosave = lock('save:alice', async () => {
            const live = await store.get('save:alice');
            autosaveRead();
            await autosavePaused;
            await store.set('save:alice', { ...live, _saveVersion: 6, character: { marker: 'stale-autosave' } });
        }, { failClosed: true });
        await readSignal;
        const restore = (0, save_snapshot_js_1.restoreSnapshotUnderLock)({
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
        node_assert_1.strict.deepEqual(data.get('save:alice'), {
            _saveVersion: 8,
            _saveAt: 100,
            character: { marker: 'snapshot' },
        });
    });
});
