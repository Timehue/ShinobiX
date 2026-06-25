/**
 * Process-local short-TTL memo cache for hot, read-only poll endpoints.
 *
 * SAFE ONLY on the single-process Railway host: every handler imports this one
 * module, so the Map is shared in-process. This mirrors the single-instance
 * assumption that api/_realtime/online-store.ts already relies on (Railway runs
 * ONE container; cPanel/Passenger spawns MANY workers and must NOT serve these
 * API routes — each worker would keep its own cache, still bounded by the TTL).
 * Going multi-instance later means swapping in a shared store, same as presence.
 *
 * Purpose: collapse repeated heavy reads (keyspace scans / mget-all / body
 * hashing) on hot poll endpoints into at most ONE build per `ttlMs`, regardless
 * of how many clients poll concurrently. The cache adds up to `ttlMs` of
 * staleness, so to keep TOTAL worst-case staleness unchanged on a CDN-cached
 * endpoint, reduce that endpoint's s-maxage by `ttlMs` (e.g. game-state: proc
 * ttl 3s + s-maxage 5s = the original 8s). Do NOT wrap an endpoint whose
 * freshness contract is `no-store` unless a write path also invalidates the key.
 *
 * The cached value is handed back BY REFERENCE and must be treated as immutable
 * (serialize it, or derive fresh objects from it — never mutate it in place).
 *
 * Single-flight: concurrent callers during a (re)build share the one in-flight
 * promise, so a burst of simultaneous polls triggers a single underlying read.
 * Rejections are NOT cached — a failed build clears the in-flight slot so the
 * next call retries with a live read.
 */
type Entry = { at: number; value: unknown };

const cache = new Map<string, Entry>();
const inflight = new Map<string, Promise<unknown>>();

export async function cachedFor<T>(
    key: string,
    ttlMs: number,
    build: () => Promise<T>,
    now: () => number = Date.now,
): Promise<T> {
    const hit = cache.get(key);
    if (hit && now() - hit.at < ttlMs) return hit.value as T;

    // A build is already running for this key — join it instead of starting a
    // second scan (thundering-herd guard when N clients poll at the same tick).
    const pending = inflight.get(key);
    if (pending) return pending as Promise<T>;

    const p = (async () => {
        const value = await build();
        cache.set(key, { at: now(), value });
        return value;
    })().finally(() => {
        inflight.delete(key);
    });
    inflight.set(key, p);
    return p as Promise<T>;
}

/** Drop a cached entry (e.g. right after a known write) so the next read rebuilds. */
export function invalidateProcCache(key: string): void {
    cache.delete(key);
    inflight.delete(key);
}

/** Test-only: wipe all cached entries + in-flight builds. */
export function __clearProcCache(): void {
    cache.clear();
    inflight.clear();
}
