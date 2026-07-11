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
// disk-routed prefixes ('save:', 'shared:images', 'shared:imgfields') and the
// base store for everything else. save-snapshot: is base-primary with a legacy
// disk fallback. For mget the routing layer must issue ONE
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
function memoryKv(initial = {}) {
    const data = new Map(Object.entries(initial));
    const api = {
        data,
        async get(key) { return (data.has(key) ? data.get(key) : null); },
        async set(key, value, options) {
            if (options?.nx && data.has(key))
                return null;
            data.set(key, structuredClone(value));
            return 'OK';
        },
        async del(...keys) { let n = 0; for (const key of keys)
            if (data.delete(key))
                n += 1; return n; },
        async incr(key) { const n = Number(data.get(key) ?? 0) + 1; data.set(key, n); return n; },
        async keys(pattern) {
            const re = new RegExp('^' + pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
            return [...data.keys()].filter((key) => re.test(key));
        },
        async mget(...keys) { return keys.map((key) => (data.has(key) ? data.get(key) : null)); },
        async hgetall(key) { return (data.has(key) ? data.get(key) : null); },
        async hkeys(key) { const v = data.get(key); return v && typeof v === 'object' ? Object.keys(v) : []; },
        async hset(key, fields) { data.set(key, { ...(data.get(key) ?? {}), ...fields }); return Object.keys(fields).length; },
        async hdel(key, ...fields) { const v = { ...(data.get(key) ?? {}) }; for (const f of fields)
            delete v[f]; data.set(key, v); return fields.length; },
    };
    return api;
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
    (0, node_test_1.it)('save-snapshot: routes to BASE (separate from live save disk), auth stays on base', async () => {
        const log = [];
        const base = makeStub('base', { 'auth:alice': 'pw', 'save-snapshot:alice:1700000000000': 'SNAP' }, log);
        const disk = makeStub('disk', { 'save:alice': 'LIVE' }, log);
        const out = await (0, _storage_js_1._makeRoutedKv)(base, disk).mget('save:alice', 'save-snapshot:alice:1700000000000', 'auth:alice');
        node_assert_1.strict.deepEqual(out, ['LIVE', 'SNAP', 'pw']);
        // Snapshot and auth share the base batch; the live save alone hits disk.
        node_assert_1.strict.deepEqual([...log].sort(), [
            'base.mget:[save-snapshot:alice:1700000000000,auth:alice]',
            'disk.mget:[save:alice]',
        ].sort());
    });
    (0, node_test_1.it)('falls back to a legacy disk snapshot only when the base copy is absent', async () => {
        const log = [];
        const base = makeStub('base', {}, log);
        const disk = makeStub('disk', { 'save-snapshot:alice:1700000000000': 'LEGACY' }, log);
        const out = await (0, _storage_js_1._makeRoutedKv)(base, disk).mget('save-snapshot:alice:1700000000000');
        node_assert_1.strict.deepEqual(out, ['LEGACY']);
        node_assert_1.strict.deepEqual(log, [
            'base.mget:[save-snapshot:alice:1700000000000]',
            'disk.mget:[save-snapshot:alice:1700000000000]',
        ]);
    });
});
(0, node_test_1.describe)('_makeRoutedKv snapshot failure-domain routing', () => {
    (0, node_test_1.it)('writes new snapshots to base while live saves remain on disk', async () => {
        const base = memoryKv();
        const disk = memoryKv();
        const routed = (0, _storage_js_1._makeRoutedKv)(base, disk);
        await routed.set('save:alice', { live: true });
        await routed.set('save-snapshot:alice:100', { backup: true });
        node_assert_1.strict.deepEqual(await disk.get('save:alice'), { live: true });
        node_assert_1.strict.equal(await base.get('save:alice'), null);
        node_assert_1.strict.deepEqual(await base.get('save-snapshot:alice:100'), { backup: true });
        node_assert_1.strict.equal(await disk.get('save-snapshot:alice:100'), null);
    });
    (0, node_test_1.it)('lists both base-primary and legacy disk snapshots without duplicates', async () => {
        const base = memoryKv({ 'save-snapshot:alice:100': 'base', 'save-snapshot:alice:200': 'both' });
        const disk = memoryKv({ 'save-snapshot:alice:50': 'legacy', 'save-snapshot:alice:200': 'legacy-duplicate' });
        const keys = await (0, _storage_js_1._makeRoutedKv)(base, disk).keys('save-snapshot:alice:*');
        node_assert_1.strict.deepEqual(keys.sort(), [
            'save-snapshot:alice:100',
            'save-snapshot:alice:200',
            'save-snapshot:alice:50',
        ].sort());
    });
});
(0, node_test_1.describe)('_migrateDiskRoutedKeys conflict safety', () => {
    (0, node_test_1.it)('never overwrites a newer/different overlay value and retains the source', async () => {
        const base = memoryKv({ 'save:alice': { _saveVersion: 2, value: 'old' } });
        const overlay = memoryKv({ 'save:alice': { _saveVersion: 9, value: 'new' } });
        const result = await (0, _storage_js_1._migrateDiskRoutedKeys)(base, overlay, ['save:']);
        node_assert_1.strict.deepEqual(result.conflicts, ['save:alice']);
        node_assert_1.strict.deepEqual(await overlay.get('save:alice'), { _saveVersion: 9, value: 'new' });
        node_assert_1.strict.deepEqual(await base.get('save:alice'), { _saveVersion: 2, value: 'old' });
        node_assert_1.strict.equal(result.deleted, 0);
    });
    (0, node_test_1.it)('copies with NX, verifies, then deletes an unchanged source', async () => {
        const base = memoryKv({ 'save:alice': { _saveVersion: 2 } });
        const overlay = memoryKv();
        const result = await (0, _storage_js_1._migrateDiskRoutedKeys)(base, overlay, ['save:']);
        node_assert_1.strict.deepEqual(result.migrated, ['save:alice']);
        node_assert_1.strict.deepEqual(await overlay.get('save:alice'), { _saveVersion: 2 });
        node_assert_1.strict.equal(await base.get('save:alice'), null);
        node_assert_1.strict.equal(result.deleted, 1);
    });
    (0, node_test_1.it)('recognizes an identical destination and removes only the verified duplicate source', async () => {
        const value = { _saveVersion: 4, character: { name: 'Alice' } };
        const base = memoryKv({ 'save:alice': value });
        const overlay = memoryKv({ 'save:alice': value });
        const result = await (0, _storage_js_1._migrateDiskRoutedKeys)(base, overlay, ['save:']);
        node_assert_1.strict.deepEqual(result.alreadyPresent, ['save:alice']);
        node_assert_1.strict.equal(result.conflicts.length, 0);
        node_assert_1.strict.equal(await base.get('save:alice'), null);
        node_assert_1.strict.deepEqual(await overlay.get('save:alice'), value);
    });
    (0, node_test_1.it)('losing the destination NX race reports a conflict without clobbering the winner', async () => {
        const base = memoryKv({ 'save:alice': { _saveVersion: 2 } });
        const backing = memoryKv();
        const overlay = {
            ...backing,
            async set(key, _value, options) {
                if (options?.nx) {
                    await backing.set(key, { _saveVersion: 10, writer: 'concurrent' });
                    return null;
                }
                return backing.set(key, _value, options);
            },
        };
        const result = await (0, _storage_js_1._migrateDiskRoutedKeys)(base, overlay, ['save:']);
        node_assert_1.strict.deepEqual(result.conflicts, ['save:alice']);
        node_assert_1.strict.deepEqual(await backing.get('save:alice'), { _saveVersion: 10, writer: 'concurrent' });
        node_assert_1.strict.notEqual(await base.get('save:alice'), null);
    });
    (0, node_test_1.it)('detects a source mutation during copy and does not delete it', async () => {
        const backing = memoryKv({ 'save:alice': { _saveVersion: 2 } });
        let reads = 0;
        const base = {
            ...backing,
            async get(key) {
                reads += 1;
                if (reads === 2) {
                    await backing.set(key, { _saveVersion: 3, writer: 'concurrent' });
                }
                return backing.get(key);
            },
        };
        const overlay = memoryKv();
        const result = await (0, _storage_js_1._migrateDiskRoutedKeys)(base, overlay, ['save:']);
        node_assert_1.strict.deepEqual(result.conflicts, ['save:alice']);
        node_assert_1.strict.deepEqual(await backing.get('save:alice'), { _saveVersion: 3, writer: 'concurrent' });
        node_assert_1.strict.equal(result.deleted, 0);
    });
});
// Transport resilience for the remote (cPanel) proxy overlay. The proxy box is
// bounced on every deploy and can be OOM-killed under load, dropping an in-flight
// response as a Passenger 502 — the GET /api/save/clan-* error this hardening
// targets. call() retries transient failures (502/503/504, network throw) but
// must NOT retry non-idempotent ops (a set with nx is a check-then-write claim).
(0, node_test_1.describe)('_makeRemoteKv transport resilience', () => {
    const realFetch = globalThis.fetch;
    let calls = [];
    // Queue-driven fake fetch: each entry is a status number (→ a Response with
    // that status) or 'throw' (→ a network error). The last entry repeats once
    // the queue is exhausted, so [502] means "502 forever".
    function installFetch(script) {
        let i = 0;
        calls = [];
        globalThis.fetch = (async () => {
            const step = script[Math.min(i, script.length - 1)];
            i += 1;
            calls.push(String(step));
            if (step === 'throw')
                throw new Error('network down');
            return {
                ok: step >= 200 && step < 300,
                status: step,
                json: async () => ({ value: 'V', result: 'OK', count: 1 }),
                text: async () => `HTTP ${step} body`,
            };
        });
    }
    (0, node_test_1.afterEach)(() => { globalThis.fetch = realFetch; });
    const kv = () => (0, _storage_js_1._makeRemoteKv)('https://proxy.example/api/kv', 'tok');
    (0, node_test_1.it)('retries a transient 502 and succeeds on a later attempt', async () => {
        installFetch([502, 502, 200]);
        node_assert_1.strict.equal(await kv().get('save:clan-x'), 'V');
        node_assert_1.strict.equal(calls.length, 3); // two retries, third attempt wins
    });
    (0, node_test_1.it)('gives up after 3 attempts when every try is a 502', async () => {
        installFetch([502]);
        await node_assert_1.strict.rejects(kv().get('save:clan-x'), /HTTP 502/);
        node_assert_1.strict.equal(calls.length, 3);
    });
    (0, node_test_1.it)('does NOT retry a deterministic 500 (fails fast, one call)', async () => {
        installFetch([500]);
        await node_assert_1.strict.rejects(kv().get('save:clan-x'), /HTTP 500/);
        node_assert_1.strict.equal(calls.length, 1);
    });
    (0, node_test_1.it)('retries a thrown network error', async () => {
        installFetch(['throw', 200]);
        node_assert_1.strict.equal(await kv().get('save:clan-x'), 'V');
        node_assert_1.strict.equal(calls.length, 2);
    });
    (0, node_test_1.it)('a plain set retries a transient 502', async () => {
        installFetch([502, 200]);
        node_assert_1.strict.equal(await kv().set('save:clan-x', { a: 1 }), 'OK');
        node_assert_1.strict.equal(calls.length, 2);
    });
    (0, node_test_1.it)('a set with nx is NOT retried — check-then-write is not idempotent', async () => {
        installFetch([502]);
        await node_assert_1.strict.rejects(kv().set('save:clan-x', { a: 1 }, { nx: true }), /HTTP 502/);
        node_assert_1.strict.equal(calls.length, 1); // single attempt only
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
