"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.perImageKey = void 0;
exports.decodeImageDataUrl = decodeImageDataUrl;
exports.default = handler;
const _storage_js_1 = require("./_storage.js");
const _utils_js_1 = require("./_utils.js");
const images_js_1 = require("./images.js");
// Phase 2 — per-image binary serving (see
// docs/load-and-refresh-perf-audit-2026-06-08.md).
//
// Replaces shipping ~33MB of base64-in-JSON on cold load. Instead of the client
// pulling 10 giant per-category blobs up front, it fetches ONE image at a time
// from `GET /api/img?id=<cat>:<id>` — each independently CDN- and browser-cached,
// loaded only when a screen actually shows it.
//
// Storage: images live as individual KV keys `shared:img:<cat>:<id>` (the cPanel
// disk KV stores each `shared:*` key as its own file — "files on cPanel disk").
// During migration we fall back to the legacy per-category blob/hash and lazily
// copy the value into a per-image key, so this works before, during, and after
// the migration with no flag day. Public + unauthenticated, same as the bulk
// `GET /api/images` (shared art is not secret).
// One image == one key. `id` is already "<cat>:<key>", so the full key is
// e.g. shared:img:jutsu:fireball.
const perImageKey = (id) => `shared:img:${id}`;
exports.perImageKey = perImageKey;
// Per-process guard: bulk-migrate each category's legacy blob into per-image
// keys at most once per instance, so a burst of first-views can't re-fire the
// whole write set. Convergence is still guaranteed because each served image
// also populates its own key (see the fallback below), so even if the bulk pass
// is skipped or partially fails, every served image self-heals individually.
const _bulkMigratedCats = new Set();
// Legacy stores (read-only fallback during migration).
const legacyHashKey = (cat) => `shared:imgfields:${cat}`;
const legacyBlobKey = (cat) => `shared:images:${cat}`;
// Parse a `data:image/<type>;base64,<payload>` URL into a mime + decoded buffer.
// Returns null for anything that isn't a base64 image data URL.
function decodeImageDataUrl(s) {
    const m = /^data:(image\/[a-z0-9+.-]+);base64,(.*)$/is.exec(s);
    if (!m)
        return null;
    try {
        const buf = Buffer.from(m[2], 'base64');
        if (buf.length === 0)
            return null;
        return { mime: m[1].toLowerCase(), buf };
    }
    catch {
        return null;
    }
}
async function handler(req, res) {
    (0, _utils_js_1.cors)(res, req);
    if (req.method === 'OPTIONS')
        return res.status(200).end();
    if (req.method !== 'GET')
        return res.status(405).end();
    const id = typeof req.query.id === 'string' ? req.query.id.trim() : '';
    if (!id || id.length > 256 || id.indexOf(':') < 0) {
        res.setHeader('Cache-Control', 'no-store');
        return res.status(400).json({ error: 'Missing or invalid image id (expected "<category>:<key>").' });
    }
    const cat = (0, images_js_1.categoryFromId)(id);
    // Per-call timeout so one slow KV read can't hang the function.
    const withTimeout = (p, ms = 18_000) => Promise.race([p, new Promise((resolve) => setTimeout(() => resolve(null), ms))]);
    try {
        // 1. Fast path: the per-image key (one small read).
        let raw = await withTimeout(_storage_js_1.kv.get((0, exports.perImageKey)(id)));
        // 2. Fallback: the legacy per-category hash/blob (pre-migration). On a
        //    hit, lazily copy into per-image keys so subsequent reads are cheap.
        //    Best-effort + async — never block the response on a migration write.
        if (!raw) {
            const [hash, blob] = await Promise.all([
                withTimeout(_storage_js_1.kv.hgetall(legacyHashKey(cat))),
                withTimeout(_storage_js_1.kv.get(legacyBlobKey(cat))),
            ]);
            raw = (hash && hash[id]) || (blob && blob[id]) || null;
            if (raw) {
                // Always migrate the served image (guarantees it converges).
                void _storage_js_1.kv.set((0, exports.perImageKey)(id), raw).catch(() => undefined);
                // Once per process per category, migrate the WHOLE blob so the
                // next request for ANY other image in this category hits the cheap
                // per-image path — turning ~one full-blob read per image into ~one
                // per category. Fire-and-forget; failures self-heal per-image.
                if (!_bulkMigratedCats.has(cat)) {
                    _bulkMigratedCats.add(cat);
                    const merged = { ...(blob ?? {}), ...(hash ?? {}) };
                    void Promise.allSettled(Object.entries(merged)
                        .filter(([k, v]) => k !== id && typeof v === 'string' && v.length > 0)
                        .map(([k, v]) => _storage_js_1.kv.set((0, exports.perImageKey)(k), v)));
                }
            }
        }
        if (!raw) {
            // Not found. Non-cacheable so a transient miss isn't pinned at the edge.
            res.setHeader('Cache-Control', 'no-store');
            return res.status(404).end();
        }
        // Some non-avatar categories allow a remote http(s) URL instead of an
        // inline data URL — redirect to it (the browser fetches it directly).
        if (/^https?:\/\//i.test(raw)) {
            res.setHeader('Cache-Control', 'public, max-age=300');
            return res.redirect(302, raw);
        }
        const decoded = decodeImageDataUrl(raw);
        if (!decoded) {
            res.setHeader('Cache-Control', 'no-store');
            return res.status(415).end();
        }
        res.setHeader('Content-Type', decoded.mime);
        // Served instantly from cache for 5 min, then revalidated in the
        // background. Cloudflare + the browser absorb refreshes; the client only
        // ever fetches the handful of images on the current screen.
        res.setHeader('Cache-Control', 'public, max-age=300, stale-while-revalidate=86400');
        return res.status(200).send(decoded.buf);
    }
    catch (err) {
        console.error('[img]', err);
        res.setHeader('Cache-Control', 'no-store');
        return res.status(404).end();
    }
}
