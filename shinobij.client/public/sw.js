/*
 * Shinobi Journey service worker — DELIBERATELY NARROW SCOPE.
 *
 * Caches ONLY content-hashed build assets (/assets/<name>-<hash>.<ext>),
 * cache-first. A hashed filename's content can never change, so cache-first
 * cannot serve a wrong version: a new deploy references NEW filenames, which
 * miss this cache and fetch from the network like normal.
 *
 * It NEVER intercepts:
 *   • navigations / index.html — the chunk map must always come from the
 *     network (a SW-served stale chunk map is the classic post-deploy
 *     white-screen, the exact bug class this game has been bitten by);
 *   • /api/* — server-authoritative, and /api/img has its own edge caching;
 *   • fixed-name media (music/, sector-map/, badges/, …) — those names get
 *     overwritten in place by art updates, so HTTP cache rules own them.
 *
 * Why it exists at all: mobile browsers evict the HTTP cache aggressively, so
 * returning players re-download the multi-hundred-KB bundles. CacheStorage is
 * far more durable, making warm loads near-instant even days later. As a
 * bonus, a player holding a STALE index.html right after a deploy can still
 * load the old (now-deleted-from-origin) chunks from this cache instead of
 * white-screening on a 404.
 *
 * Rollback: ship a new sw.js that deletes caches and unregisters — never just
 * remove the file (browsers keep running the last-fetched worker).
 */

const CACHE = 'sj-hashed-assets-v1';
// Same hashed-output signature server.ts uses for its immutable-cache rule:
// an exactly-8-char base64url token after the final hyphen.
const HASHED_ASSET_RE = /^\/assets\/[^/]+-[A-Za-z0-9_-]{8}\.[a-z0-9]+$/;
// FIFO cap so years of deploys can't grow the cache without bound. ~220 covers
// the full current chunk set (~120 files) plus one prior deploy generation.
const MAX_ENTRIES = 220;

self.addEventListener('install', () => {
    // No precache — nothing to wait for; activate immediately.
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil((async () => {
        const names = await caches.keys();
        await Promise.all(names.filter((name) => name !== CACHE).map((name) => caches.delete(name)));
        await self.clients.claim();
    })());
});

async function trimCache(cache) {
    const keys = await cache.keys();
    const excess = keys.length - MAX_ENTRIES;
    for (let i = 0; i < excess; i += 1) await cache.delete(keys[i]);
}

self.addEventListener('fetch', (event) => {
    const request = event.request;
    if (request.method !== 'GET') return;
    const url = new URL(request.url);
    if (url.origin !== self.location.origin) return;
    if (!HASHED_ASSET_RE.test(url.pathname)) return; // fall through to the network untouched
    event.respondWith((async () => {
        const cache = await caches.open(CACHE);
        const cached = await cache.match(request);
        if (cached) return cached;
        const response = await fetch(request);
        if (response.ok) {
            // Clone before the body is consumed; trim + put are fire-and-forget
            // so a storage error can never break the actual response.
            const copy = response.clone();
            event.waitUntil(cache.put(request, copy).then(() => trimCache(cache)).catch(() => undefined));
        }
        return response;
    })());
});
