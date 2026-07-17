"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const node_assert_1 = require("node:assert");
const _lock_js_1 = require("./_lock.js");
const _storage_js_1 = require("./_storage.js");
// Exercises the lock orchestration (acquire → run → release) and the
// `failClosed` acquire-failure policy via injected primitives — no KV, no
// network, deterministic. `withKvLock` is a thin wrapper that binds the real KV
// store to `withLockCore`, so this covers its behavior too. Small backoff keeps
// the retry path fast.
const FAST = { maxAttempts: 2, baseBackoffMs: 1 };
(0, node_test_1.describe)('withLockCore', () => {
    (0, node_test_1.it)('runs fn and releases the lock when acquisition succeeds', async () => {
        const released = [];
        const prims = {
            tryAcquire: async () => 'owner-1',
            release: async (k, token) => { released.push(`${k}:${token}`); },
        };
        let ran = false;
        const result = await (0, _lock_js_1.withLockCore)('clan-foo', async () => { ran = true; return 42; }, prims, FAST);
        node_assert_1.strict.equal(result, 42);
        node_assert_1.strict.equal(ran, true);
        node_assert_1.strict.deepEqual(released, ['lock:clan-foo:owner-1']);
    });
    (0, node_test_1.it)('falls through and runs fn UNLOCKED when acquisition fails and failClosed is off', async () => {
        const released = [];
        const prims = {
            tryAcquire: async () => null,
            release: async (k) => { released.push(k); },
        };
        let ran = false;
        const result = await (0, _lock_js_1.withLockCore)('chat-foo', async () => { ran = true; return 'ok'; }, prims, FAST);
        node_assert_1.strict.equal(result, 'ok');
        node_assert_1.strict.equal(ran, true, 'fn still runs unlocked (social-path fallback)');
        node_assert_1.strict.deepEqual(released, [], 'never acquired → nothing to release');
    });
    (0, node_test_1.it)('THROWS LockContendedError and does NOT run fn when failClosed and acquisition fails', async () => {
        const prims = {
            tryAcquire: async () => null,
            release: async () => { throw new Error('release should never be called'); },
        };
        let ran = false;
        await node_assert_1.strict.rejects(() => (0, _lock_js_1.withLockCore)('save:treasury', async () => { ran = true; return 1; }, prims, { ...FAST, failClosed: true }), (err) => err instanceof _lock_js_1.LockContendedError && err.lockTarget === 'save:treasury');
        node_assert_1.strict.equal(ran, false, 'critical section must NOT run unlocked');
    });
    (0, node_test_1.it)('treats a tryAcquire throw as a failed attempt, then fails closed', async () => {
        let attempts = 0;
        const prims = {
            tryAcquire: async () => { attempts++; throw new Error('KV down'); },
            release: async () => { },
        };
        await node_assert_1.strict.rejects(() => (0, _lock_js_1.withLockCore)('save:treasury', async () => 1, prims, { ...FAST, failClosed: true }), _lock_js_1.LockContendedError);
        node_assert_1.strict.equal(attempts, 2, 'retried up to maxAttempts before failing closed');
    });
    (0, node_test_1.it)('acquires on a later attempt and runs fn', async () => {
        let n = 0;
        const released = [];
        const prims = {
            tryAcquire: async () => { n++; return n >= 2 ? 'owner-2' : null; }, // fail once, then succeed
            release: async (k, token) => { released.push(`${k}:${token}`); },
        };
        let ran = false;
        const r = await (0, _lock_js_1.withLockCore)('x', async () => { ran = true; return 'done'; }, prims, { maxAttempts: 3, baseBackoffMs: 1, failClosed: true });
        node_assert_1.strict.equal(r, 'done');
        node_assert_1.strict.equal(ran, true);
        node_assert_1.strict.deepEqual(released, ['lock:x:owner-2']);
    });
    (0, node_test_1.it)('passes the acquired owner token to release', async () => {
        let releasedToken = '';
        const prims = {
            tryAcquire: async () => 'owner-token',
            release: async (_k, token) => { releasedToken = token; },
        };
        await (0, _lock_js_1.withLockCore)('x', async () => 'ok', prims, FAST);
        node_assert_1.strict.equal(releasedToken, 'owner-token');
    });
});
// The real kv-backed primitives, exercised against an in-memory KV so the
// compare-and-delete release contract is covered end-to-end (not just the fake
// primitives above). This is the concrete regression for the release TOCTOU.
(0, node_test_1.describe)('makeKvLockPrimitives (compare-and-delete release)', () => {
    (0, node_test_1.it)('release deletes only the caller-owned lock, never a re-acquired one', async () => {
        const kv = (0, _storage_js_1._makeMemoryKv)();
        const prims = (0, _lock_js_1.makeKvLockPrimitives)(kv);
        const lockKey = 'lock:save:treasury';
        const tokenA = await prims.tryAcquire(lockKey, 5);
        node_assert_1.strict.ok(tokenA, 'A acquires');
        // A second acquire fails while A holds the lock (mutual exclusion).
        node_assert_1.strict.equal(await prims.tryAcquire(lockKey, 5), null, 'B blocked while A holds');
        // Simulate A's lease expiring and B re-acquiring by force-replacing the
        // lock value with a different owner token.
        await kv.set(lockKey, 'ownerB', { ex: 5 });
        // A's release must NOT delete B's lock.
        await prims.release(lockKey, tokenA);
        node_assert_1.strict.equal(await kv.get(lockKey), 'ownerB', "A's stale release left B's lock intact");
        // B's own release clears exactly its lock.
        await prims.release(lockKey, 'ownerB');
        node_assert_1.strict.equal(await kv.get(lockKey), null);
    });
    (0, node_test_1.it)('a full acquire → run → release cycle frees the lock for the next holder', async () => {
        const kv = (0, _storage_js_1._makeMemoryKv)();
        const prims = (0, _lock_js_1.makeKvLockPrimitives)(kv);
        let ran = 0;
        await (0, _lock_js_1.withLockCore)('save:bank', async () => { ran++; }, prims, { ...FAST, failClosed: true });
        // Lock was released, so a second failClosed critical section still runs.
        await (0, _lock_js_1.withLockCore)('save:bank', async () => { ran++; }, prims, { ...FAST, failClosed: true });
        node_assert_1.strict.equal(ran, 2);
    });
});
