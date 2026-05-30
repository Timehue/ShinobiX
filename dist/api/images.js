"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
const _storage_js_1 = require("./_storage.js");
const _utils_js_1 = require("./_utils.js");
const _auth_js_1 = require("./_auth.js");
// Max raw image string length (≈ base64 of a ~2 MB image). Anything bigger is
// rejected — keeps disk usage bounded and stops one player from filling the
// shared image bucket with megabyte uploads.
const MAX_IMAGE_BYTES = 3_000_000;
function isValidImageString(s) {
    if (s.length > MAX_IMAGE_BYTES)
        return false;
    // Accept ONLY raster-image data URLs (png/jpeg/webp/gif) or http(s) URLs.
    // SVG is intentionally rejected: SVG can carry <script> tags. The current
    // client only ever renders avatar/pet/jutsu images via <img src>, which
    // browsers treat as opaque raster — so SVG is technically safe today, but
    // it's a XSS time-bomb the moment any future code uses an image URL in
    // dangerouslySetInnerHTML / <object> / <iframe>. Better to lock it down
    // now than to discover it later.
    if (/^data:image\/(png|jpe?g|webp|gif);base64,/i.test(s))
        return true;
    if (/^https?:\/\//i.test(s))
        return true;
    return false;
}
// Legacy single-blob key (kept for backward-compat reads during migration)
const LEGACY_KEY = 'shared:images';
// Old per-category JSON blob keys (kept for backward-compat reads)
const catKey = (cat) => `shared:images:${cat}`;
// New per-category Redis hash keys — HSET is atomic per-field, eliminating
// the GET→modify→SET race condition that caused concurrent uploads to overwrite
// each other and permanently lose images.
const catHashKey = (cat) => `shared:imgfields:${cat}`;
const KNOWN_PREFIXES = {
    avatar: 'avatar',
    pet: 'pet',
    jutsu: 'jutsu',
    item: 'item',
    card: 'card',
    event: 'event',
    bloodline: 'bloodline',
    vn: 'event', // visual-novel pages share the event category
    ai: 'ai',
    // Hollow Gate Shrine assets: backgrounds + tile/scene illustrations + intro VN pages
    // ride under their own 'shrine' bucket; world-map landmarks (like the Hollow Gate POI)
    // ride under 'landmark'. Without these, both would fall into 'misc' and the bulk GET
    // (which only walks KNOWN_CATEGORIES) would never return them.
    shrine: 'shrine',
    landmark: 'landmark',
};
const KNOWN_CATEGORIES = Array.from(new Set(Object.values(KNOWN_PREFIXES)));
function categoryFromId(id) {
    const prefix = id.split(':')[0];
    return KNOWN_PREFIXES[prefix] ?? 'misc';
}
// Admin-only image prefixes. The admin tooling owns these (jutsus, items,
// AIs, events, cards, bloodlines, VN backdrops, shrine assets, world-map
// landmarks). Players can't add or replace them — without this gate, any
// authed player can POST id="jutsu:fireball" with an arbitrary image and
// overwrite the actual jutsu icon shown to everyone.
const ADMIN_ONLY_PREFIXES = new Set(['jutsu', 'item', 'card', 'event', 'vn', 'ai', 'shrine', 'landmark', 'bloodline']);
// Returns null if the identity may write to this image id; otherwise an
// HTTP { status, error } describing the rejection.
function ownershipReject(id, identity) {
    if (identity.admin)
        return null;
    const colon = id.indexOf(':');
    if (colon < 0) {
        return { status: 400, error: 'Image id must use the "<category>:<key>" format.' };
    }
    const prefix = id.slice(0, colon).toLowerCase();
    const rest = id.slice(colon + 1);
    if (ADMIN_ONLY_PREFIXES.has(prefix)) {
        return { status: 403, error: `${prefix} images are admin-only.` };
    }
    if (prefix === 'avatar') {
        // avatar:<lowercased player name>. Only the player themselves may
        // upload or replace their own avatar.
        if (rest.toLowerCase() !== identity.name.toLowerCase()) {
            return { status: 403, error: 'You can only set your own avatar.' };
        }
    }
    if (prefix === 'pet') {
        // pet:<petId>. We don't have a fast pet-ownership lookup here —
        // pet IDs are client-generated. The misc-per-player cap covers
        // abuse magnitude, but per-pet ownership would need a save read.
        // For now, allow any authed player to write pet images. Future:
        // optionally cross-check char.pets.some(p => p.id === rest).
    }
    return null;
}
async function handler(req, res) {
    (0, _utils_js_1.cors)(res, req);
    if (req.method === 'OPTIONS')
        return res.status(200).end();
    if (req.method === 'GET') {
        try {
            const cat = typeof req.query.cat === 'string' ? req.query.cat.trim() : '';
            res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=120');
            // Helper: read a kv value with a per-call timeout so one slow Supabase
            // REST response never hangs the whole function.
            // 18s per KV call — Supabase client aborts at 20s, function maxDuration is 30s.
            // This ordering (18 < 20 < 30) ensures: Promise.race fires, Supabase aborts,
            // function returns cleanly — never hard-killed mid-flight by Vercel.
            const withTimeout = (p, ms = 18_000) => Promise.race([p, new Promise((resolve) => setTimeout(() => resolve(null), ms))]);
            if (cat) {
                // Fetch hash (primary) and old blob (backward-compat) in parallel.
                // Skip the legacy single-blob key — it's empty after migration and
                // is multi-MB; reading it on every request causes Vercel timeouts.
                const [hashImages, catImages] = await Promise.all([
                    withTimeout(_storage_js_1.kv.hgetall(catHashKey(cat))),
                    withTimeout(_storage_js_1.kv.get(catKey(cat))),
                ]);
                // Merge: old blob < new hash (newest always wins)
                return res.status(200).json({
                    ...(catImages ?? {}),
                    ...(hashImages ?? {}),
                });
            }
            // No category param — return everything (admin / bulk use).
            // Run per-category fetches in parallel with individual timeouts.
            const categoryEntries = await Promise.all(KNOWN_CATEGORIES.flatMap((category) => [
                withTimeout(_storage_js_1.kv.get(catKey(category))),
                withTimeout(_storage_js_1.kv.hgetall(catHashKey(category))),
            ]));
            return res.status(200).json(Object.assign({}, ...categoryEntries.map((entry) => entry ?? {})));
        }
        catch (err) {
            console.error('[images GET error]', err);
            return res.status(200).json({}); // return empty rather than hanging/500
        }
    }
    if (req.method === 'POST') {
        // Uploads require a logged-in player. Stops random bots from replacing
        // jutsu icons or kage portraits with arbitrary content.
        const identity = await (0, _auth_js_1.authedPlayerOrAdmin)(req);
        if (!identity)
            return res.status(401).json({ error: 'Authentication required.' });
        try {
            const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
            const { id, image } = body;
            if (!id || typeof image !== 'string')
                return res.status(400).json({ error: 'Missing id or image.' });
            if (id.length > 256)
                return res.status(400).json({ error: 'Image id too long.' });
            if (!isValidImageString(image)) {
                return res.status(400).json({ error: 'Image must be a valid data URL or http(s) URL under 3 MB.' });
            }
            // Ownership: non-admins can't overwrite admin-prefixed images
            // (jutsu/item/event/etc) and can only write avatar:<their-name>.
            const reject = ownershipReject(id, identity);
            if (reject)
                return res.status(reject.status).json({ error: reject.error });
            const cat = categoryFromId(id);
            // Per-player cap on "misc" (uncategorized) uploads — stops a single
            // account filling the shared bucket. Tracked by uploader; admins exempt.
            const MAX_MISC_PER_PLAYER = 50;
            if (cat === 'misc' && !identity.admin) {
                const counterKey = `upload:misc-count:${identity.name}`;
                const current = Number((await _storage_js_1.kv.get(counterKey)) ?? 0);
                if (current >= MAX_MISC_PER_PLAYER) {
                    return res.status(429).json({ error: `Per-player misc image cap reached (${MAX_MISC_PER_PLAYER}).` });
                }
                // Best-effort increment; counter resets only on admin tooling.
                await _storage_js_1.kv.set(counterKey, current + 1).catch(() => undefined);
            }
            // Atomic HSET — sets exactly this one field without touching any other
            // image in the same category. Eliminates the race condition.
            await _storage_js_1.kv.hset(catHashKey(cat), { [id]: image });
            return res.status(200).end();
        }
        catch (err) {
            console.error('[images]', err);
            return res.status(500).json({ error: 'Internal server error.' });
        }
    }
    if (req.method === 'DELETE') {
        // Used by the admin tooling (atlas picker "clear slot", per-asset
        // "clear image" buttons). POST with empty string used to be the way
        // to nominally delete, but isValidImageString rejected empty strings,
        // so server-side state never actually cleared. This branch does a
        // real HDEL on the category's hash field so reloads no longer
        // resurrect cleared slots.
        const identity = await (0, _auth_js_1.authedPlayerOrAdmin)(req);
        if (!identity)
            return res.status(401).json({ error: 'Authentication required.' });
        try {
            // Accept the id either as ?id= query param OR JSON body, for
            // flexibility with fetch wrappers that strip DELETE bodies.
            const queryId = typeof req.query.id === 'string' ? req.query.id : '';
            let bodyId = '';
            if (req.body) {
                const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
                if (body && typeof body.id === 'string')
                    bodyId = body.id;
            }
            const id = queryId || bodyId;
            if (!id)
                return res.status(400).json({ error: 'Missing id.' });
            if (id.length > 256)
                return res.status(400).json({ error: 'Image id too long.' });
            // Same ownership rules as POST — players can't HDEL admin-owned
            // assets or other players' avatars.
            const reject = ownershipReject(id, identity);
            if (reject)
                return res.status(reject.status).json({ error: reject.error });
            const cat = categoryFromId(id);
            await _storage_js_1.kv.hdel(catHashKey(cat), id);
            // Also clear the legacy per-cat blob field in case the image
            // lived there (pre-hash-migration uploads).
            const blob = await _storage_js_1.kv.get(catKey(cat));
            if (blob && id in blob) {
                const next = { ...blob };
                delete next[id];
                await _storage_js_1.kv.set(catKey(cat), next);
            }
            return res.status(200).end();
        }
        catch (err) {
            console.error('[images DELETE]', err);
            return res.status(500).json({ error: 'Internal server error.' });
        }
    }
    return res.status(405).end();
}
