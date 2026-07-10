"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const node_assert_1 = require("node:assert");
const node_fs_1 = require("node:fs");
const node_os_1 = require("node:os");
const node_path_1 = require("node:path");
const _storage_js_1 = require("./_storage.js");
const _single_use_token_js_1 = require("./_single-use-token.js");
// The routed KV splits keys across two backends — a disk overlay for the
// disk-routed prefixes ('save:', 'save-snapshot:', 'shared:images',
// 'shared:imgfields') and the base store for everything else. For mget the routing layer must issue ONE
// batched call per backend (so the remote/Vercel overlay does a single HTTP
// round-trip, not one per key) and then re-interleave the results back into the
// caller's original key order. These tests pin that contract: same values, same
// order, missing keys → null, and NO per-key get fallback.
// Minimal KvLike that records every mget/get and serves values from a map.
// Unused methods throw so the test fails loudly if mget ever takes the per-key
// path or touches a mutating op.
function makeStub(label, store, log) {
    const unused = (m) => () => { throw new Error(`${label}.${m} should not be called in an mget test`); };
    return {
        async get(key) {
            log.push(`${label}.get:${key}`);
            return (key in store ? store[key] : null);
        },
        async mget(...keys) {
            log.push(`${label}.mget:[${keys.join(',')}]`);
            return keys.map((k) => (k in store ? store[k] : null));
        },
        set: unused('set'),
        del: unused('del'),
        incr: unused('incr'),
        keys: unused('keys'),
        hgetall: unused('hgetall'),
        hkeys: unused('hkeys'),
        hset: unused('hset'),
        hdel: unused('hdel'),
    };
}
(0, node_test_1.describe)('_makeRoutedKv.mget', () => {
    (0, node_test_1.it)('batches each backend once and re-interleaves into the original key order', async () => {
        const log = [];
        const base = makeStub('base', { 'presence:bob': 'B', 'queue:1': 'Q' }, log);
        const disk = makeStub('disk', { 'save:alice': 'A', 'save:carol': 'C' }, log);
        const kv = (0, _storage_js_1._makeRoutedKv)(base, disk);
        // Interleaved disk/base keys; one disk key is absent → expect null in slot.
        const keys = ['save:alice', 'presence:bob', 'save:carol', 'queue:1', 'save:missing'];
        const out = await kv.mget(...keys);
        // Values align to the input order, missing key is null.
        node_assert_1.strict.deepEqual(out, ['A', 'B', 'C', 'Q', null]);
        // Exactly one batched call per backend, each preserving sub-order; no per-key gets.
        node_assert_1.strict.deepEqual([...log].sort(), [
            'base.mget:[presence:bob,queue:1]',
            'disk.mget:[save:alice,save:carol,save:missing]',
        ].sort());
        node_assert_1.strict.equal(log.some((l) => l.includes('.get:')), false);
    });
    (0, node_test_1.it)('all disk-routed keys → only the disk backend is queried (one call)', async () => {
        const log = [];
        const base = makeStub('base', {}, log);
        const disk = makeStub('disk', { 'save:a': 1, 'save:b': 2 }, log);
        const out = await (0, _storage_js_1._makeRoutedKv)(base, disk).mget('save:a', 'save:b');
        node_assert_1.strict.deepEqual(out, [1, 2]);
        node_assert_1.strict.deepEqual(log, ['disk.mget:[save:a,save:b]']);
    });
    (0, node_test_1.it)('all base-routed keys → only the base backend is queried (one call)', async () => {
        const log = [];
        const base = makeStub('base', { 'x:1': 'x', 'y:2': 'y' }, log);
        const disk = makeStub('disk', {}, log);
        const out = await (0, _storage_js_1._makeRoutedKv)(base, disk).mget('x:1', 'y:2');
        node_assert_1.strict.deepEqual(out, ['x', 'y']);
        node_assert_1.strict.deepEqual(log, ['base.mget:[x:1,y:2]']);
    });
    (0, node_test_1.it)('empty key list returns [] and queries neither backend', async () => {
        const log = [];
        const base = makeStub('base', {}, log);
        const disk = makeStub('disk', {}, log);
        const out = await (0, _storage_js_1._makeRoutedKv)(base, disk).mget();
        node_assert_1.strict.deepEqual(out, []);
        node_assert_1.strict.deepEqual(log, []);
    });
    (0, node_test_1.it)('repeated and adjacent same-backend keys keep their order and duplicates', async () => {
        const log = [];
        const base = makeStub('base', { 'queue:1': 'Q' }, log);
        const disk = makeStub('disk', { 'save:a': 'A' }, log);
        const out = await (0, _storage_js_1._makeRoutedKv)(base, disk).mget('save:a', 'save:a', 'queue:1', 'save:a');
        node_assert_1.strict.deepEqual(out, ['A', 'A', 'Q', 'A']);
    });
    (0, node_test_1.it)('save-snapshot: routes to DISK (backups go to cPanel), auth: stays on base', async () => {
        const log = [];
        const base = makeStub('base', { 'auth:alice': 'pw' }, log);
        const disk = makeStub('disk', { 'save:alice': 'LIVE', 'save-snapshot:alice:1700000000000': 'SNAP' }, log);
        const out = await (0, _storage_js_1._makeRoutedKv)(base, disk).mget('save:alice', 'save-snapshot:alice:1700000000000', 'auth:alice');
        node_assert_1.strict.deepEqual(out, ['LIVE', 'SNAP', 'pw']);
        // The snapshot blob must land in the DISK batch (cPanel), NOT the base
        // store (Supabase) — and 'save:' must not swallow 'save-snapshot:'.
        node_assert_1.strict.deepEqual([...log].sort(), [
            'base.mget:[auth:alice]',
            'disk.mget:[save:alice,save-snapshot:alice:1700000000000]',
        ].sort());
    });
});
// Regression (2026-07-09): disk-overlay hset/hdel are read-modify-write over a
// single JSON file. Unserialized, N parallel hsets all read the same snapshot
// and the last write wins — concurrently-published images vanished from the
// shared:imgfields:<cat> id manifest (GET /api/images?cat=X&ids=1) while
// remaining individually servable via their own shared:img:<id> keys. These
// tests hammer the ops that must now serialize per key (_withDiskKeyLock).
(0, node_test_1.describe)('_makeDiskKv concurrent RMW', () => {
    const root = (0, node_fs_1.mkdtempSync)((0, node_path_1.join)((0, node_os_1.tmpdir)(), 'shinobix-diskkv-'));
    (0, node_test_1.after)(() => (0, node_fs_1.rmSync)(root, { recursive: true, force: true }));
    (0, node_test_1.it)('N parallel hset calls land all N fields (no lost updates)', async () => {
        const kv = (0, _storage_js_1._makeDiskKv)(root);
        const N = 25;
        await Promise.all(Array.from({ length: N }, (_, i) => kv.hset('shared:imgfields:shrine', { [`shrine:tile-${i}`]: `img-${i}` })));
        const keys = await kv.hkeys('shared:imgfields:shrine');
        node_assert_1.strict.equal(keys.length, N, `manifest lost ${N - keys.length} of ${N} concurrent fields`);
    });
    (0, node_test_1.it)('parallel hsets across TWO instances on the same root land all fields', async () => {
        // kv's _diskOverlay and the /api/kv proxy's _diskKvForProxy are separate
        // _makeDiskKv instances over one root in the same process — the
        // serialization must be shared between them, not per-instance.
        const a = (0, _storage_js_1._makeDiskKv)(root);
        const b = (0, _storage_js_1._makeDiskKv)(root);
        await Promise.all(Array.from({ length: 10 }, (_, i) => (i % 2 ? a : b).hset('shared:imgfields:pet', { [`pet:${i}`]: 'x' })));
        node_assert_1.strict.equal((await a.hkeys('shared:imgfields:pet')).length, 10);
    });
    (0, node_test_1.it)('concurrent hset + hdel settle to the exact expected field set', async () => {
        const kv = (0, _storage_js_1._makeDiskKv)(root);
        await kv.hset('h:mix', { a: 1, b: 2 });
        await Promise.all([kv.hdel('h:mix', 'a'), kv.hset('h:mix', { c: 3 })]);
        const all = await kv.hgetall('h:mix');
        node_assert_1.strict.deepEqual(Object.keys(all ?? {}).sort(), ['b', 'c']);
    });
    (0, node_test_1.it)('set nx: exactly one of N concurrent claimers wins', async () => {
        const kv = (0, _storage_js_1._makeDiskKv)(root);
        const results = await Promise.all(Array.from({ length: 8 }, (_, i) => kv.set('claim:one', `owner-${i}`, { nx: true })));
        node_assert_1.strict.equal(results.filter((r) => r === 'OK').length, 1);
    });
    (0, node_test_1.it)('hset preserves untouched fields and hdel removes only the named ones', async () => {
        const kv = (0, _storage_js_1._makeDiskKv)(root);
        await kv.hset('h:basic', { keep: 'k', drop: 'd' });
        await kv.hset('h:basic', { added: 'a' });
        await kv.hdel('h:basic', 'drop');
        node_assert_1.strict.deepEqual(await kv.hgetall('h:basic'), { keep: 'k', added: 'a' });
    });
});
(0, node_test_1.describe)('consumeSingleUseToken', () => {
    (0, node_test_1.it)('returns the token when the delete actually consumed it', async () => {
        const token = { playerName: 'rin' };
        const store = {
            async get() { return token; },
            async del() { return 1; },
        };
        node_assert_1.strict.deepEqual(await (0, _single_use_token_js_1.consumeSingleUseToken)(store, 'token:key'), token);
    });
    (0, node_test_1.it)('refuses a raced duplicate when the token was read but delete removed nothing', async () => {
        const store = {
            async get() { return { playerName: 'rin' }; },
            async del() { return 0; },
        };
        node_assert_1.strict.equal(await (0, _single_use_token_js_1.consumeSingleUseToken)(store, 'token:key'), null);
    });
    (0, node_test_1.it)('does not delete when the token is absent', async () => {
        let delCalls = 0;
        const store = {
            async get() { return null; },
            async del() { delCalls += 1; return 0; },
        };
        node_assert_1.strict.equal(await (0, _single_use_token_js_1.consumeSingleUseToken)(store, 'token:key'), null);
        node_assert_1.strict.equal(delCalls, 0);
    });
});
