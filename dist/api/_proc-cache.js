"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.cachedFor = cachedFor;
exports.invalidateProcCache = invalidateProcCache;
exports.__clearProcCache = __clearProcCache;
const cache = new Map();
const inflight = new Map();
async function cachedFor(key, ttlMs, build, now = Date.now) {
    const hit = cache.get(key);
    if (hit && now() - hit.at < ttlMs)
        return hit.value;
    // A build is already running for this key — join it instead of starting a
    // second scan (thundering-herd guard when N clients poll at the same tick).
    const pending = inflight.get(key);
    if (pending)
        return pending;
    const p = (async () => {
        const value = await build();
        cache.set(key, { at: now(), value });
        return value;
    })().finally(() => {
        inflight.delete(key);
    });
    inflight.set(key, p);
    return p;
}
/** Drop a cached entry (e.g. right after a known write) so the next read rebuilds. */
function invalidateProcCache(key) {
    cache.delete(key);
    inflight.delete(key);
}
/** Test-only: wipe all cached entries + in-flight builds. */
function __clearProcCache() {
    cache.clear();
    inflight.clear();
}
