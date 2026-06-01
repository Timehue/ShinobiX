"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const node_assert_1 = require("node:assert");
const _lock_js_1 = require("./_lock.js");
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
            tryAcquire: async () => true,
            release: async (k) => { released.push(k); },
        };
        let ran = false;
        const result = await (0, _lock_js_1.withLockCore)('clan-foo', async () => { ran = true; return 42; }, prims, FAST);
        node_assert_1.strict.equal(result, 42);
        node_assert_1.strict.equal(ran, true);
        node_assert_1.strict.deepEqual(released, ['lock:clan-foo']);
    });
    (0, node_test_1.it)('falls through and runs fn UNLOCKED when acquisition fails and failClosed is off', async () => {
        const released = [];
        const prims = {
            tryAcquire: async () => false,
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
            tryAcquire: async () => false,
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
            tryAcquire: async () => { n++; return n >= 2; }, // fail once, then succeed
            release: async (k) => { released.push(k); },
        };
        let ran = false;
        const r = await (0, _lock_js_1.withLockCore)('x', async () => { ran = true; return 'done'; }, prims, { maxAttempts: 3, baseBackoffMs: 1, failClosed: true });
        node_assert_1.strict.equal(r, 'done');
        node_assert_1.strict.equal(ran, true);
        node_assert_1.strict.deepEqual(released, ['lock:x']);
    });
});
