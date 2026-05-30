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
 * The lock key is `lock:<target>` with a short TTL (default 2s) so a crashed
 * lambda can't deadlock the key forever. Acquire is attempted up to
 * `maxAttempts` times with exponential backoff (25ms → 50ms → 100ms → 200ms).
 *
 * If the lock cannot be acquired in time, we still run the function — losing a
 * single chat message under sustained contention is better than dropping the
 * write entirely. The race window is much smaller than before because most
 * concurrent writers serialize through the lock; only the tail end of a
 * contention burst will race.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.withKvLock = withKvLock;
const _storage_js_1 = require("./_storage.js");
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
/**
 * Acquire a short-lived lock around `target`, run `fn`, release the lock.
 * Falls through to running `fn` unlocked if the lock can't be acquired in
 * time (better to race occasionally than to drop the write).
 */
async function withKvLock(target, fn, opts = {}) {
    const ttlSec = opts.ttlSec ?? 2;
    const maxAttempts = opts.maxAttempts ?? 5;
    const base = opts.baseBackoffMs ?? 25;
    const lockKey = `lock:${target}`;
    let acquired = false;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        try {
            const ok = await _storage_js_1.kv.set(lockKey, '1', { nx: true, ex: ttlSec });
            if (ok) {
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
    try {
        return await fn();
    }
    finally {
        if (acquired) {
            await _storage_js_1.kv.del(lockKey).catch(() => 0);
        }
    }
}
