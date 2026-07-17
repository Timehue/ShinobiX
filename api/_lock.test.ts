import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { withLockCore, LockContendedError, makeKvLockPrimitives, type LockPrimitives } from './_lock.js';
import { _makeMemoryKv } from './_storage.js';

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
            tryAcquire: async () => 'owner-1',
            release: async (k, token) => { released.push(`${k}:${token}`); },
        };
        let ran = false;
        const result = await withLockCore('clan-foo', async () => { ran = true; return 42; }, prims, FAST);
        assert.equal(result, 42);
        assert.equal(ran, true);
        assert.deepEqual(released, ['lock:clan-foo:owner-1']);
    });

    it('falls through and runs fn UNLOCKED when acquisition fails and failClosed is off', async () => {
        const released: string[] = [];
        const prims: LockPrimitives = {
            tryAcquire: async () => null,
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
            tryAcquire: async () => null,
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
            tryAcquire: async () => { n++; return n >= 2 ? 'owner-2' : null; }, // fail once, then succeed
            release: async (k, token) => { released.push(`${k}:${token}`); },
        };
        let ran = false;
        const r = await withLockCore('x', async () => { ran = true; return 'done'; }, prims, { maxAttempts: 3, baseBackoffMs: 1, failClosed: true });
        assert.equal(r, 'done');
        assert.equal(ran, true);
        assert.deepEqual(released, ['lock:x:owner-2']);
    });

    it('passes the acquired owner token to release', async () => {
        let releasedToken = '';
        const prims: LockPrimitives = {
            tryAcquire: async () => 'owner-token',
            release: async (_k, token) => { releasedToken = token; },
        };
        await withLockCore('x', async () => 'ok', prims, FAST);
        assert.equal(releasedToken, 'owner-token');
    });
});

// The real kv-backed primitives, exercised against an in-memory KV so the
// compare-and-delete release contract is covered end-to-end (not just the fake
// primitives above). This is the concrete regression for the release TOCTOU.
describe('makeKvLockPrimitives (compare-and-delete release)', () => {
    it('release deletes only the caller-owned lock, never a re-acquired one', async () => {
        const kv = _makeMemoryKv();
        const prims = makeKvLockPrimitives(kv);
        const lockKey = 'lock:save:treasury';

        const tokenA = await prims.tryAcquire(lockKey, 5);
        assert.ok(tokenA, 'A acquires');
        // A second acquire fails while A holds the lock (mutual exclusion).
        assert.equal(await prims.tryAcquire(lockKey, 5), null, 'B blocked while A holds');

        // Simulate A's lease expiring and B re-acquiring by force-replacing the
        // lock value with a different owner token.
        await kv.set(lockKey, 'ownerB', { ex: 5 });
        // A's release must NOT delete B's lock.
        await prims.release(lockKey, tokenA!);
        assert.equal(await kv.get(lockKey), 'ownerB', "A's stale release left B's lock intact");

        // B's own release clears exactly its lock.
        await prims.release(lockKey, 'ownerB');
        assert.equal(await kv.get(lockKey), null);
    });

    it('a full acquire → run → release cycle frees the lock for the next holder', async () => {
        const kv = _makeMemoryKv();
        const prims = makeKvLockPrimitives(kv);
        let ran = 0;
        await withLockCore('save:bank', async () => { ran++; }, prims, { ...FAST, failClosed: true });
        // Lock was released, so a second failClosed critical section still runs.
        await withLockCore('save:bank', async () => { ran++; }, prims, { ...FAST, failClosed: true });
        assert.equal(ran, 2);
    });
});
