/* Narrow SW: hashed assets are cache-first; same-origin images use a bounded
 * last-known-good cache. HTML and non-image API requests are never intercepted. */

const ASSET_CACHE = 'sj-hashed-assets-v1';
const IMAGE_CACHE = 'sj-game-images-v1';
const MODEL_CACHE = 'sj-3d-models-v1';
// Same 8-character hashed-output signature used by server.ts.
const HASHED_ASSET_RE = /^\/assets\/[^/]+-[A-Za-z0-9_-]{8}\.[a-z0-9]+$/;
// 3D model payloads. `request.destination` is '' for these (they're fetched as
// array buffers by the GLTF loader), so neither branch below ever saw them and
// every pet model re-downloaded on each visit. They carry a ?v= revision in the
// URL (ROSTER_MODEL_ASSET_REVISION), so cache-first on the full href is safe —
// a re-certified model changes the key. Individual GLBs are large, so the entry
// cap is deliberately small: a session only meets a handful of pets.
const MODEL_ASSET_RE = /\.(?:glb|gltf|bin|ktx2|basis)$/i;
const MAX_ASSET_ENTRIES = 220;
const MAX_IMAGE_ENTRIES = 400;
const MAX_MODEL_ENTRIES = 24;

self.addEventListener('install', () => {
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil((async () => {
        const names = await caches.keys();
        const current = new Set([ASSET_CACHE, IMAGE_CACHE, MODEL_CACHE]);
        await Promise.all(names.filter((name) => name.startsWith('sj-') && !current.has(name)).map((name) => caches.delete(name)));
        await self.clients.claim();
    })());
});

async function trimCache(cache, maxEntries) {
    const keys = await cache.keys();
    const excess = keys.length - maxEntries;
    for (let i = 0; i < excess; i += 1) await cache.delete(keys[i]);
}

function withoutRetryParam(rawUrl) {
    const url = new URL(rawUrl);
    url.searchParams.delete('__img_retry');
    return url.href;
}

function isCacheableImageResponse(response) {
    // Reject accidental SPA HTML/JSON and explicitly private responses.
    if (response.type === 'opaque') return true;
    if (!response.ok) return false;
    const contentType = (response.headers.get('content-type') || '').toLowerCase();
    const cacheControl = (response.headers.get('cache-control') || '').toLowerCase();
    return contentType.startsWith('image/') && !/\b(?:no-store|private)\b/.test(cacheControl);
}

async function cacheSuccessfulImage(cache, cacheKey, request) {
    const response = await fetch(request);
    if (isCacheableImageResponse(response)) {
        const copy = response.clone();
        await cache.put(cacheKey, copy);
        await trimCache(cache, MAX_IMAGE_ENTRIES);
    } else if (response.status === 404 || response.status === 410) {
        await cache.delete(cacheKey);
    }
    return response;
}

self.addEventListener('fetch', (event) => {
    const request = event.request;
    if (request.method !== 'GET') return;
    const url = new URL(request.url);
    if (url.origin !== self.location.origin) return;
    if (HASHED_ASSET_RE.test(url.pathname)) {
        event.respondWith((async () => {
            const cache = await caches.open(ASSET_CACHE);
            const cacheKey = withoutRetryParam(url.href);
            const cached = await cache.match(cacheKey);
            if (cached) return cached;
            const response = await fetch(request);
            if (response.ok) {
                const copy = response.clone();
                event.waitUntil(cache.put(cacheKey, copy).then(() => trimCache(cache, MAX_ASSET_ENTRIES)).catch(() => undefined));
            }
            return response;
        })());
        return;
    }

    // 3D models: cache-first on the revision-stamped URL. Storage quota failures
    // are non-fatal — the response is still returned, it just isn't cached.
    if (MODEL_ASSET_RE.test(url.pathname)) {
        event.respondWith((async () => {
            const cache = await caches.open(MODEL_CACHE);
            const cached = await cache.match(url.href);
            if (cached) return cached;
            const response = await fetch(request);
            if (response.ok) {
                const copy = response.clone();
                event.waitUntil(cache.put(url.href, copy).then(() => trimCache(cache, MAX_MODEL_ENTRIES)).catch(() => undefined));
            }
            return response;
        })());
        return;
    }

    // Paint last-known-good art immediately, then refresh it in the background.
    if (request.destination !== 'image') return;
    event.respondWith((async () => {
        const cache = await caches.open(IMAGE_CACHE);
        const cacheKey = withoutRetryParam(url.href);
        const cached = await cache.match(cacheKey);
        if (cached) {
            event.waitUntil(cacheSuccessfulImage(cache, cacheKey, request).catch(() => undefined));
            return cached;
        }
        const response = await fetch(request);
        if (isCacheableImageResponse(response)) {
            const copy = response.clone();
            event.waitUntil(cache.put(cacheKey, copy).then(() => trimCache(cache, MAX_IMAGE_ENTRIES)).catch(() => undefined));
        }
        return response;
    })());
});
