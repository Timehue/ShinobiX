"use strict";
/**
 * Generic KV-backed lock with retry — serializes concurrent read-modify-write
 * operations on a single key so two writers can't silently overwrite each
 * other's changes.
 *
 * Pattern:
 *   await withKvLock('chat:village:foo', async () => {
 *       const existing = await kv.get('chat:village:foo') ?? [];
 *       const next = [...existing, newMessage];
 *       await kv.set('chat:village:foo', next);
 *   });
 *
 * The lock key is `lock:<target>` with a short TTL (default 5s) so a crashed
 * lambda can't deadlock the key forever. Acquire is attempted up to
 * `maxAttempts` times with exponential backoff (25ms → 50ms → 100ms → 200ms).
 *
 * By default, if the lock cannot be acquired in time, we still run the
 * function — losing a single chat message under sustained contention is better
 * than dropping the write entirely. The race window is much smaller than before
 * because most concurrent writers serialize through the lock; only the tail end
 * of a contention burst will race.
 *
 * That fall-through is WRONG for economy / currency / war critical sections,
 * where a silent unlocked read-modify-write can mint or lose currency or
 * corrupt shared state. Pass `{ failClosed: true }` on those call sites: if the
 * lock can't be acquired, `withKvLock` THROWS (LockContendedError) instead of
 * running `fn` unlocked. Because the lock wraps the whole RMW, the throw lands
 * BEFORE any mutation, so the operation aborts cleanly and the caller's outer
 * try/catch turns it into a 500 the client retries — strictly safer than racing
 * (audit item #10).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.LockContendedError = void 0;
exports.withLockCore = withLockCore;
exports.withKvLock = withKvLock;
const _storage_js_1 = require("./_storage.js");
/**
 * Thrown by {@link withKvLock} / {@link withLockCore} when `failClosed` is set
 * and the lock could not be acquired (sustained contention or KV unavailable).
 * Callers let it propagate to their generic catch, which returns a 500/503.
 */
class LockContendedError extends Error {
    lockTarget;
    constructor(lockTarget) {
        super(`Could not acquire lock for "${lockTarget}" — contended or KV unavailable.`);
        this.lockTarget = lockTarget;
        this.name = 'LockContendedError';
    }
}
exports.LockContendedError = LockContendedError;
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
/**
 * Lock orchestration over injected primitives. Acquire `lock:<target>` with
 * retry + backoff, run `fn`, release. See {@link LockOptions.failClosed} for the
 * acquire-failure policy. Public entry point is {@link withKvLock}, which binds
 * the real KV store; tests exercise this directly with fake primitives.
 */
async function withLockCore(target, fn, primitives, opts = {}) {
    // Default 5s (raised from 2s): currency RMW critical sections route save:
    // keys to the remote cPanel disk proxy over HTTP (several round-trips), which
    // a 2s TTL could occasionally outlive — the lock would expire mid-operation,
    // a second writer could slip in, and the slow holder would then delete the
    // NEW holder's lock on release. 5s comfortably covers a normal op; a crashed
    // holder still auto-releases (just 5s later), and failClosed waiters that
    // can't acquire within the retry budget throw + retry rather than race.
    const ttlSec = opts.ttlSec ?? 5;
    const maxAttempts = opts.maxAttempts ?? 5;
    const base = opts.baseBackoffMs ?? 25;
    const lockKey = `lock:${target}`;
    let acquired = false;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        try {
            if (await primitives.tryAcquire(lockKey, ttlSec)) {
                acquired = true;
                break;
            }
        }
        catch {
            // Lock acquire failed (KV hiccup) — fall through, retry
        }
        // Backoff with jitter so contending writers don't synchronize their retries.
        const delay = base * Math.pow(2, attempt) + Math.floor(Math.random() * base);
        await sleep(delay);
    }
    // Critical sections opt into failing closed: abort BEFORE running `fn`
    // (which holds the unlocked RMW) rather than racing.
    if (!acquired && opts.failClosed) {
        throw new LockContendedError(target);
    }
    try {
        return await fn();
    }
    finally {
        if (acquired) {
            await primitives.release(lockKey).catch(() => undefined);
        }
    }
}
// Real KV-backed primitives. `kv.set` with {nx} resolves truthy ('OK') only
// when the key was newly created, i.e. the lock was claimed.
const kvLockPrimitives = {
    tryAcquire: async (lockKey, ttlSec) => Boolean(await _storage_js_1.kv.set(lockKey, '1', { nx: true, ex: ttlSec })),
    release: async (lockKey) => { await _storage_js_1.kv.del(lockKey); },
};
/**
 * Acquire a short-lived KV lock around `target`, run `fn`, release the lock.
 * Falls through to running `fn` unlocked if the lock can't be acquired in
 * time (better to race occasionally than to drop the write) — UNLESS
 * `{ failClosed: true }` is passed, in which case it throws (see module docs).
 */
async function withKvLock(target, fn, opts = {}) {
    return withLockCore(target, fn, kvLockPrimitives, opts);
}
