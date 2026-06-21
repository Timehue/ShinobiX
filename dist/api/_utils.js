"use strict";
// Shared utilities for Vercel API functions
Object.defineProperty(exports, "__esModule", { value: true });
exports.ALLOWED_ORIGINS = void 0;
exports.safeName = safeName;
exports.clanBareSlug = clanBareSlug;
exports.clanRecordKey = clanRecordKey;
exports.mergePreservingImages = mergePreservingImages;
exports.isAllowedOrigin = isAllowedOrigin;
exports.cors = cors;
// Max length for a player / clan-slug name. KV keys like `save:<name>`,
// `ratelimit:save:<name>:gains`, `presence:<name>`, etc. embed this string,
// so an unbounded length inflates every key the player touches. 32 chars
// covers any realistic display name; longer inputs are truncated rather
// than rejected so legacy code that hands raw user input here keeps working.
const SAFE_NAME_MAX_LEN = 32;
function safeName(name) {
    return name.toLowerCase().replace(/[^a-z0-9\-_]/g, '').slice(0, SAFE_NAME_MAX_LEN);
}
// Canonical clan-record key derivation (audit #19). A clan's shared save lives
// at `save:clan-<bareSlug>` where bareSlug strips the display name down to
// [a-z0-9] only ("Storm Clan" → "stormclan"). Many call sites inline this rule;
// centralize it here so a new caller can't drift — e.g. pet-escort/offer.ts
// once derived a HYPHENATED slug ("storm-clan") and so silently failed to find
// any multi-word clan's record. Use clanRecordKey() for the full KV key.
function clanBareSlug(name) {
    return name.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}
function clanRecordKey(name) {
    return `save:clan-${clanBareSlug(name)}`;
}
function recordId(value) {
    return value && typeof value === 'object' && 'id' in value
        ? String(value.id)
        : undefined;
}
function isImageField(key, value) {
    return (key === 'image' ||
        key === 'avatarImage' ||
        key === 'leftImage' ||
        key === 'rightImage') && typeof value === 'string';
}
function mergePreservingImages(incoming, existing) {
    // Arrays: take the incoming sequence verbatim (preserving order +
    // intentional deletions), but per-item recurse so embedded images and
    // nested objects merge cleanly with the matching existing entry.
    if (Array.isArray(incoming)) {
        const existingArray = Array.isArray(existing) ? existing : [];
        // Index existing items by id ONCE (first occurrence wins, matching the
        // previous .find() semantics) instead of an O(n) .find() per incoming
        // item — avoids O(n*m) on large id-bearing arrays (defeatedAiIds,
        // jutsuMastery, inventory). Items without an id fall back to positional
        // pairing, exactly as before.
        const existingById = new Map();
        for (const c of existingArray) {
            const cid = recordId(c);
            if (cid && !existingById.has(cid))
                existingById.set(cid, c);
        }
        return incoming.map((item, index) => {
            const itemId = recordId(item);
            const match = itemId ? existingById.get(itemId) : undefined;
            return mergePreservingImages(item, match ?? existingArray[index]);
        });
    }
    if (!incoming || typeof incoming !== 'object')
        return incoming;
    const inc = incoming;
    const ex = existing && typeof existing === 'object' ? existing : {};
    // Objects: start with `existing` so any field present on the stored
    // record but ABSENT from the incoming payload is preserved. The incoming
    // payload then overrides field-by-field. This defends against partial-
    // payload writes (e.g. a foreign-save fetch returning a public projection
    // of ~19 fields then being POSTed back, which used to silently wipe the
    // remaining ~30 fields of the recipient's save — inventory, pets,
    // jutsuMastery, equipment, stats, etc.). Players send their full state on
    // normal auto-save, so this change is a no-op there.
    const merged = { ...ex };
    for (const [key, value] of Object.entries(inc)) {
        if (isImageField(key, value) && value === '' && typeof ex[key] === 'string' && String(ex[key]).startsWith('data:image')) {
            merged[key] = ex[key];
            continue;
        }
        merged[key] = value && typeof value === 'object'
            ? mergePreservingImages(value, ex[key])
            : value;
    }
    return merged;
}
// Origins we trust to call our API. Anything not on this list won't get
// browser-side CORS approval — protects authenticated calls from XSRF via
// random sites.
//
// SINGLE SOURCE OF TRUTH for the CORS origin allowlist: server.ts (the Express
// global CORS middleware) and api/_realtime/socket.ts (Socket.IO cors) both
// import this exact array, so the three surfaces can no longer drift apart
// (CLAUDE.md: keep CORS in api/_utils.ts and server.ts synchronized).
exports.ALLOWED_ORIGINS = [
    // Player-facing site (Railway primary). Pinned here in code so the Socket.IO
    // handshake + any cross-origin call keep working even if EXTRA_ALLOWED_ORIGINS
    // is ever dropped/mistyped on a redeploy — realtime no longer depends on that
    // env var being set correctly.
    'https://shinobijourney.com',
    'https://www.shinobijourney.com',
    // cPanel backend tier (KV-proxy + image bulk storage; not front-facing).
    'https://theravensark.com',
    'https://www.theravensark.com',
    // Local dev — Vite default ports
    'http://localhost:5173',
    'http://localhost:3000',
    'http://127.0.0.1:5173',
];
// Operators can add the deployment's OWN origin without a code change via the
// EXTRA_ALLOWED_ORIGINS env var (comma-separated) — e.g. a Railway custom
// domain, or a transient preview URL during the migration. Every CORS surface
// (cors() here, the Express middleware in server.ts, and the Socket.IO layer in
// api/_realtime/socket.ts) routes through isAllowedOrigin(), so all three stay
// in lockstep (CLAUDE.md: keep CORS synchronized).
const EXTRA_ALLOWED_ORIGINS = (process.env.EXTRA_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
const ALLOWED_ORIGIN_SET = new Set([...exports.ALLOWED_ORIGINS, ...EXTRA_ALLOWED_ORIGINS]);
// Railway gives every service a stable `<service>.up.railway.app` origin (and
// `<branch>-<service>.up.railway.app` for PR previews). Allow any HTTPS origin
// on that exact suffix so the API + Socket.IO handshake keep working when the
// app is reached at its Railway URL before a custom domain is attached. Matched
// on the PARSED hostname (not a substring) so a lookalike like
// `up.railway.app.attacker.com` can't slip through.
function isRailwayOrigin(origin) {
    try {
        const u = new URL(origin);
        return u.protocol === 'https:' && (u.hostname === 'up.railway.app' || u.hostname.endsWith('.up.railway.app'));
    }
    catch {
        return false;
    }
}
// The single predicate every CORS surface uses to decide if an Origin is
// trusted. Exported so server.ts + socket.ts share the exact same logic.
function isAllowedOrigin(origin) {
    if (!origin)
        return false;
    return ALLOWED_ORIGIN_SET.has(origin) || isRailwayOrigin(origin);
}
// Methods that browsers consider "safe" — these can't mutate state, so even
// a CSRF-style attack from a third-party page can't do damage. For these we
// allow the open '*' fallback when no Origin header is present.
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
function cors(res, req) {
    const originHeader = req?.headers?.origin;
    const origin = Array.isArray(originHeader) ? originHeader[0] : originHeader;
    const method = (req?.method ?? 'GET').toUpperCase();
    if (origin && isAllowedOrigin(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Vary', 'Origin');
    }
    else if (!origin && SAFE_METHODS.has(method)) {
        // Same-origin / curl / server-to-server — no Origin header sent, and
        // the method itself is safe (cannot mutate state). Allowing '*' here
        // is fine. For unsafe methods with no Origin we default-deny by
        // omitting the ACAO header.
        res.setHeader('Access-Control-Allow-Origin', '*');
    }
    // If origin is set but not allowed, or method is unsafe without Origin:
    // no ACAO header is emitted. Browser blocks the request.
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-password, x-player-password, x-player-name, x-player-token, x-kv-token, x-client-fp');
}
