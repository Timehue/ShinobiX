import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { withLockCore, LockContendedError, type LockPrimitives } from './_lock.js';

// Exercises the lock orchestration (acquire → run → release) and the
// `failClosed` acquire-failure policy via injected primitives — no KV, no
// network, deterministic. `withKvLock` is a thin wrapper that binds the real KV
// store to `withLockCore`, so this covers its behavior too. Small backoff keeps
// the retry path fast.
const FAST = { maxAttempts: 2, baseBackoffMs: 1 };

describe('withLockCore', () => {
    it('runs fn and releases the lock when acquisition succeeds', async () => {
        const released: string[] = [];
        const prims: LockPrimitives = {
            tryAcquire: async () => true,
            release: async (k) => { released.push(k); },
        };
        let ran = false;
        const result = await withLockCore('clan-foo', async () => { ran = true; return 42; }, prims, FAST);
        assert.equal(result, 42);
        assert.equal(ran, true);
        assert.deepEqual(released, ['lock:clan-foo']);
    });

    it('falls through and runs fn UNLOCKED when acquisition fails and failClosed is off', async () => {
        const released: string[] = [];
        const prims: LockPrimitives = {
            tryAcquire: async () => false,
            release: async (k) => { released.push(k); },
        };
        let ran = false;
        const result = await withLockCore('chat-foo', async () => { ran = true; return 'ok'; }, prims, FAST);
        assert.equal(result, 'ok');
        assert.equal(ran, true, 'fn still runs unlocked (social-path fallback)');
        assert.deepEqual(released, [], 'never acquired → nothing to release');
    });

    it('THROWS LockContendedError and does NOT run fn when failClosed and acquisition fails', async () => {
        const prims: LockPrimitives = {
            tryAcquire: async () => false,
            release: async () => { throw new Error('release should never be called'); },
        };
        let ran = false;
        await assert.rejects(
            () => withLockCore('save:treasury', async () => { ran = true; return 1; }, prims, { ...FAST, failClosed: true }),
            (err: unknown) => err instanceof LockContendedError && err.lockTarget === 'save:treasury',
        );
        assert.equal(ran, false, 'critical section must NOT run unlocked');
    });

    it('treats a tryAcquire throw as a failed attempt, then fails closed', async () => {
        let attempts = 0;
        const prims: LockPrimitives = {
            tryAcquire: async () => { attempts++; throw new Error('KV down'); },
            release: async () => { /* unused */ },
        };
        await assert.rejects(
            () => withLockCore('save:treasury', async () => 1, prims, { ...FAST, failClosed: true }),
            LockContendedError,
        );
        assert.equal(attempts, 2, 'retried up to maxAttempts before failing closed');
    });

    it('acquires on a later attempt and runs fn', async () => {
        let n = 0;
        const released: string[] = [];
        const prims: LockPrimitives = {
            tryAcquire: async () => { n++; return n >= 2; }, // fail once, then succeed
            release: async (k) => { released.push(k); },
        };
        let ran = false;
        const r = await withLockCore('x', async () => { ran = true; return 'done'; }, prims, { maxAttempts: 3, baseBackoffMs: 1, failClosed: true });
        assert.equal(r, 'done');
        assert.equal(ran, true);
        assert.deepEqual(released, ['lock:x']);
    });
});
