"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const node_assert_1 = require("node:assert");
const _storage_js_1 = require("./_storage.js");
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
