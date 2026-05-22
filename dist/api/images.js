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
    // Accept data URLs for png/jpeg/webp/gif/svg, or http(s) URLs.
    if (/^data:image\/(png|jpe?g|webp|gif|svg\+xml);base64,/i.test(s))
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
};
const KNOWN_CATEGORIES = Array.from(new Set(Object.values(KNOWN_PREFIXES)));
function categoryFromId(id) {
    const prefix = id.split(':')[0];
    return KNOWN_PREFIXES[prefix] ?? 'misc';
}
async function handler(req, res) {
    (0, _utils_js_1.cors)(res);
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
            if (!isValidImageString(image)) {
                return res.status(400).json({ error: 'Image must be a valid data URL or http(s) URL under 3 MB.' });
            }
            const cat = categoryFromId(id);
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
    return res.status(405).end();
}
