"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isUnsafeImageUrlHost = isUnsafeImageUrlHost;
exports.isValidImageString = isValidImageString;
exports.base64DecodedByteLength = base64DecodedByteLength;
exports.avatarImageReject = avatarImageReject;
exports.categoryFromId = categoryFromId;
exports.ownershipReject = ownershipReject;
exports.default = handler;
const _storage_js_1 = require("./_storage.js");
const _utils_js_1 = require("./_utils.js");
const _auth_js_1 = require("./_auth.js");
const _asset_registry_js_1 = require("./_asset-registry.js");
const _audit_js_1 = require("./_audit.js");
// Max raw image string length (≈ base64 of a ~2 MB image). Anything bigger is
// rejected — keeps disk usage bounded and stops one player from filling the
// shared image bucket with megabyte uploads.
const MAX_IMAGE_BYTES = 3_000_000;
// Reject http(s) image URLs whose host is internal / non-public (audit #23).
// The server never fetches these URLs today — they're rendered browser-side as
// <img src> — so this is not an active SSRF sink. But storing a loopback /
// private / link-local target would (a) become a latent SSRF the moment any
// future code fetches a stored image URL, and (b) turn other players' browsers
// into probes against internal infrastructure when they render it. Legitimate
// external images are public-CDN URLs with a dotted public hostname, so this
// rejects only clearly-internal targets and the classic IP-obfuscation bypasses.
function isUnsafeImageUrlHost(rawHost) {
    let host = rawHost.toLowerCase().trim();
    if (host.startsWith('[') && host.endsWith(']'))
        host = host.slice(1, -1); // URL.hostname brackets IPv6
    if (!host)
        return true;
    // localhost + common internal / mDNS TLDs.
    if (host === 'localhost' || host.endsWith('.localhost'))
        return true;
    if (/\.(local|internal|lan|home|corp|intranet)$/.test(host))
        return true;
    // IPv6 literals: loopback / link-local (fe80::/10) / unique-local (fc00::/7).
    if (host.includes(':')) {
        if (host === '::1' || host === '::')
            return true;
        if (host.startsWith('fe80:') || host.startsWith('fc') || host.startsWith('fd'))
            return true;
        return false; // other IPv6 literals are global
    }
    // Bare single-label host (e.g. 'router', 'intranet') — never a public image
    // host; resolves internally on most networks.
    if (!host.includes('.'))
        return true;
    // Numeric / hex-obfuscated IPv4 (e.g. '2130706433', '0x7f000001') — classic
    // SSRF bypass; no legitimate public image host is a bare number.
    if (/^[0-9]+$/.test(host) || /^0x[0-9a-f]+$/.test(host))
        return true;
    // Dotted IPv4 private / loopback / link-local / CGNAT ranges.
    const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (m) {
        const a = Number(m[1]), b = Number(m[2]);
        if (a === 0 || a === 127)
            return true; // this-host / loopback
        if (a === 10)
            return true; // 10.0.0.0/8
        if (a === 192 && b === 168)
            return true; // 192.168.0.0/16
        if (a === 169 && b === 254)
            return true; // link-local 169.254.0.0/16
        if (a === 172 && b >= 16 && b <= 31)
            return true; // 172.16.0.0/12
        if (a === 100 && b >= 64 && b <= 127)
            return true; // CGNAT 100.64.0.0/10
    }
    return false;
}
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
    if (/^https?:\/\//i.test(s)) {
        // External URL — allow only public hosts (block internal SSRF targets).
        try {
            return !isUnsafeImageUrlHost(new URL(s).hostname);
        }
        catch {
            return false; // malformed URL
        }
    }
    return false;
}
// ── Avatar-specific validation (audit #15) ──────────────────────────────────
// Avatars are the only player-set image rendered at scale across rosters /
// leaderboards / PvP, and animated ones bypass canvas compression (raw bytes
// hit storage), so they get a tighter, decoded-size cap than the generic 3 MB
// string limit — and must be INLINE data URLs. A remote http(s) URL can't be
// size- or animation-verified server-side and would let an avatar point at an
// arbitrary (or rotating) external resource that every other player's browser
// then fetches; we reject those for avatars even though they're allowed for
// other categories.
const MAX_AVATAR_DECODED_BYTES = 2 * 1024 * 1024; // 2 MB
// Decoded byte length of a base64 data URL, computed from the string without
// allocating the buffer (3 bytes per 4 base64 chars, minus '=' padding).
function base64DecodedByteLength(dataUrl) {
    const comma = dataUrl.indexOf(',');
    const b64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
    const len = b64.length;
    if (len === 0)
        return 0;
    const pad = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
    return Math.floor((len * 3) / 4) - pad;
}
// Returns an error string if the avatar image is unacceptable, else null.
function avatarImageReject(image) {
    if (!/^data:image\/(png|jpe?g|webp|gif);base64,/i.test(image)) {
        return 'Avatars must be an uploaded image (data URL), not an external link.';
    }
    if (base64DecodedByteLength(image) > MAX_AVATAR_DECODED_BYTES) {
        return 'Avatar image too large — must be under 2 MB.';
    }
    return null;
}
// Legacy single-blob key (kept for backward-compat reads during migration)
const LEGACY_KEY = 'shared:images';
// Old per-category JSON blob keys (kept for backward-compat reads)
const catKey = (cat) => `shared:images:${cat}`;
// New per-category Redis hash keys — HSET is atomic per-field, eliminating
// the GET→modify→SET race condition that caused concurrent uploads to overwrite
// each other and permanently lose images.
const catHashKey = (cat) => `shared:imgfields:${cat}`;
// Backcompat (audit #16): leader:* portraits uploaded before 'leader' was a
// known category were stored in the 'misc' hash. Pull those fields back out so
// they still resolve; new uploads now route to the 'leader' hash and win.
async function leaderImagesFromMisc(withTimeout) {
    const misc = await withTimeout(_storage_js_1.kv.hgetall(catHashKey('misc')));
    const out = {};
    if (misc)
        for (const [k, v] of Object.entries(misc))
            if (k.startsWith('leader:'))
                out[k] = v;
    return out;
}
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
    // Village leadership portraits (kage / elders), shown in each village's
    // Town Hall. The client publishes `leader:<village>:kage` /
    // `leader:<village>:elder:<n>`. Without this entry these fell into 'misc'
    // (so the bulk GET, which only walks KNOWN_CATEGORIES, never returned them).
    // Admin-only — see ADMIN_ONLY_PREFIXES. (audit #16)
    leader: 'leader',
    // Pet BATTLE-ART slots the renderer already reads from sharedImages:
    // `petbody:<id>` (transparent full-body battle sprite — HD-2D coliseum +
    // the DOM full-body standee), `petsheet:<id>` (baked animation strip) and
    // `petlayers:<id>:<band>` (depth-sliced 2.5D parallax). Riding the 'pet'
    // category means loadCategory('pet')'s id manifest returns them, so the
    // client hydrates them with no client changes. Without these entries they
    // fell into 'misc', which the client never loads. Deliberately NOT
    // admin-only — exact parity with 'pet' portraits (same bounded cosmetic
    // exposure; see the pet ownership note in ownershipReject).
    petbody: 'pet',
    petsheet: 'pet',
    petlayers: 'pet',
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
const ADMIN_ONLY_PREFIXES = new Set(['jutsu', 'item', 'card', 'event', 'vn', 'ai', 'shrine', 'landmark', 'bloodline', 'leader']);
// Player-forged named gear (`item:named-weapon-<rand>` / `item:named-armor-<rand>`).
// These are UNIQUE, single-owner items the player creates in the Crafter — not
// part of the shared catalog — so letting the owner attach an image can't
// overwrite an icon shown to everyone (unlike a generic `item:<catalog-id>`).
const PLAYER_NAMED_ITEM_RE = /^named-(weapon|armor)-/;
// Player-created bloodline + that bloodline's jutsu ids. The Bloodline Maker is
// a player-facing feature; every new bloodline id and jutsu id it mints is a
// crypto.randomUUID() (client lib/utils.makeId + lib/jutsu.blankJutsu), whereas
// the admin CATALOG uses readable ids ('starter-bloodline-*', 'starter-*'
// jutsus). Matching ONLY the UUID shape lets a player image their own custom
// bloodline/jutsus while keeping every catalog asset admin-only (a non-UUID id
// still 403s). UUID v1–v5 (any version/variant nibble) so older saves match too.
const PLAYER_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
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
    // Carve-out: a player may image their OWN forged named item even though the
    // 'item' prefix is otherwise admin-only. Ownership is intentionally fail-open
    // (matching the 'pet' precedent below): the client publishes optimistically
    // on forge, before the debounced autosave persists the item to save:<name>,
    // so a strict owns-it check would 403 legitimate uploads. Abuse is bounded —
    // random unguessable ids, the 3 MB per-image cap, and a purely cosmetic blast
    // radius (overwriting one named item's picture whose id is already known).
    if (prefix === 'item' && PLAYER_NAMED_ITEM_RE.test(rest)) {
        return null;
    }
    // Carve-out: a player may image their OWN custom bloodline + that bloodline's
    // jutsus. The Bloodline Maker publishes 'bloodline:<id>' / 'jutsu:<id>'
    // optimistically BEFORE the debounced save persists the bloodline to
    // save:<name> (the same race that forces the pet/named-item fail-open below),
    // so a strict owns-it check would 403 legitimate first-time uploads. Scope
    // the fail-open to the random UUID ids the maker generates so the readable
    // admin catalog ids ('bloodline:starter-*', 'jutsu:starter-*') stay
    // admin-only. Abuse is bounded + purely cosmetic: a player who learns
    // another's random bloodline/jutsu id (it appears in the public gallery)
    // could overwrite that one picture — never a catalog asset, never stats.
    if ((prefix === 'bloodline' || prefix === 'jutsu') && PLAYER_UUID_RE.test(rest)) {
        return null;
    }
    if (ADMIN_ONLY_PREFIXES.has(prefix)) {
        return { status: 403, error: `${prefix} images are admin-only.` };
    }
    if (prefix === 'avatar') {
        // avatar:<player name>. Only the player themselves may upload or replace
        // their own avatar. Canonicalize the id's name part through safeName so it
        // matches identity.name (the safeName slug) — otherwise a player whose
        // name has a space could never set their own avatar.
        if ((0, _utils_js_1.safeName)(rest) !== identity.name) {
            return { status: 403, error: 'You can only set your own avatar.' };
        }
    }
    if (prefix === 'pet') {
        // pet:<petId>. Ownership is intentionally NOT enforced here (audit #23).
        // A save-read check (char.pets.some(p => p.id === rest)) looks tempting
        // but would reject legitimately-created pet portraits: the client
        // publishes 'pet:<id>' optimistically (App.tsx, on file pick / AI gen)
        // BEFORE the debounced autosave persists the new pet to save:<name>, so
        // a fresh pet's id is not yet in the stored save at upload time. A strict
        // check would 403 real uploads; a fail-open check gives no protection.
        // Closing this properly needs the client to save-then-upload (a larger
        // change). Abuse magnitude is bounded by the 256-char id cap and the
        // shared-bucket size; the worst case is cosmetic (overwriting a pet
        // portrait whose client-generated id an attacker already knows).
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
                // Phase 2 (image-as-files): manifest mode. `?ids=1` returns ONLY
                // the id list — and reads ONLY keys from storage (kv.hkeys), never
                // the multi-MB image payloads. The old implementation hgetall'd
                // the whole bucket (~18 MB once battle sprites doubled the pet
                // category) just to call Object.keys; when that read timed out it
                // SILENTLY degraded to the legacy-blob keys — clients then ran a
                // whole session with new art (petbody:*) missing. Two fixes here:
                // keys-only reads, and a hard 503 (no-store) when the primary
                // read fails so a degraded list is never served or cached.
                if (req.query.ids) {
                    // hkeys with a one-deploy-skew fallback: if the remote proxy
                    // doesn't know the op yet (rolling deploy), fall back to the
                    // old full read. null = both attempts failed (NOT empty).
                    const keysOf = async (key) => {
                        try {
                            return await _storage_js_1.kv.hkeys(key);
                        }
                        catch { /* old proxy / transient */ }
                        try {
                            const all = await _storage_js_1.kv.hgetall(key);
                            return all && typeof all === 'object' ? Object.keys(all) : [];
                        }
                        catch {
                            return null;
                        }
                    };
                    const [hashKeys, blobKeys, leaderKeys] = await Promise.all([
                        withTimeout(keysOf(catHashKey(cat))),
                        withTimeout(keysOf(catKey(cat))),
                        cat === 'leader'
                            ? withTimeout(keysOf(catHashKey('misc'))).then((ks) => (ks === null ? null : ks.filter((k) => k.startsWith('leader:'))))
                            : Promise.resolve([]),
                    ]);
                    if (hashKeys === null || blobKeys === null || leaderKeys === null) {
                        // Storage unavailable — make the client retry rather than
                        // caching/running with a silently incomplete manifest.
                        res.setHeader('Cache-Control', 'no-store');
                        return res.status(503).json({ error: 'image index temporarily unavailable' });
                    }
                    return res.status(200).json(Array.from(new Set([...leaderKeys, ...blobKeys, ...hashKeys])));
                }
                // Full-content mode (admin/bulk use) — fetch hash (primary) and
                // old blob (backward-compat) in parallel.
                const [hashImages, catImages, legacyLeader] = await Promise.all([
                    withTimeout(_storage_js_1.kv.hgetall(catHashKey(cat))),
                    withTimeout(_storage_js_1.kv.get(catKey(cat))),
                    // audit #16: leader:* portraits uploaded before 'leader' was a
                    // known category landed in the 'misc' hash. Pull them back out
                    // so old portraits still resolve (new uploads go to 'leader').
                    cat === 'leader' ? leaderImagesFromMisc(withTimeout) : Promise.resolve({}),
                ]);
                // Merge: legacy misc < old blob < new hash (newest always wins)
                const merged = {
                    ...(legacyLeader ?? {}),
                    ...(catImages ?? {}),
                    ...(hashImages ?? {}),
                };
                return res.status(200).json(merged);
            }
            // No category param — return everything (admin / bulk use).
            // Run per-category fetches in parallel with individual timeouts.
            const [categoryEntries, legacyLeader] = await Promise.all([
                Promise.all(KNOWN_CATEGORIES.flatMap((category) => [
                    withTimeout(_storage_js_1.kv.get(catKey(category))),
                    withTimeout(_storage_js_1.kv.hgetall(catHashKey(category))),
                ])),
                // audit #16 backcompat — legacy leader portraits parked in 'misc'.
                leaderImagesFromMisc(withTimeout),
            ]);
            // legacyLeader first so the real 'leader' hash (in categoryEntries) wins.
            return res.status(200).json(Object.assign({}, legacyLeader, ...categoryEntries.map((entry) => entry ?? {})));
        }
        catch (err) {
            console.error('[images GET error]', err);
            // Override the success Cache-Control set above — an empty result
            // caused by a transient KV failure must NOT be cached by the CDN /
            // browser, or a blip would blank images for up to max-age. Return
            // empty (so the client degrades gracefully rather than 500ing) but
            // make it non-cacheable so the next request re-fetches live data.
            res.setHeader('Cache-Control', 'no-store');
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
            const parsed = (0, _utils_js_1.parseJsonBody)(req.body);
            if (!parsed.ok)
                return res.status(400).json({ error: parsed.error });
            const { id, image } = parsed.body;
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
            // Avatar hardening (audit #15): inline data URL only + 2 MB decoded
            // cap. Applied after isValidImageString (which would otherwise let a
            // remote http(s) URL or a 3 MB still through for an avatar).
            if (cat === 'avatar') {
                const avReject = avatarImageReject(image);
                if (avReject)
                    return res.status(400).json({ error: avReject });
            }
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
            // Phase 2 (image-as-files): also write the per-image key so
            // GET /api/img can serve it directly and the client can lazy-load it
            // instead of the bulk base64 blob. Dual-write keeps the legacy bulk
            // GET /api/images working throughout the migration. Best-effort — a
            // failure here must not fail the upload (the hash write above is
            // authoritative; /api/img falls back to it and self-heals on read).
            await _storage_js_1.kv.set(`shared:img:${id}`, image).catch(() => undefined);
            // Asset registry (Priority 6) + content audit (Priority 8). Both are
            // best-effort and feature-gated (DISABLE_ASSET_META) — they wrap
            // metadata around the write above and can never fail or alter it.
            const actor = identity.admin ? 'admin' : identity.name;
            await (0, _asset_registry_js_1.writeAssetMeta)({ id, category: cat, image, actor });
            await (0, _audit_js_1.recordAudit)({
                domain: 'content', actor, action: 'image.set',
                entityType: 'image', entityId: id,
                meta: { category: cat, format: (0, _asset_registry_js_1.imageFormat)(image) },
            });
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
                const parsed = (0, _utils_js_1.parseJsonBody)(req.body);
                if (!parsed.ok)
                    return res.status(400).json({ error: parsed.error });
                const body = parsed.body;
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
            // Phase 2: also drop the per-image key so /api/img stops serving it.
            await _storage_js_1.kv.del(`shared:img:${id}`).catch(() => undefined);
            // Drop the registry metadata + audit the removal (best-effort).
            const actor = identity.admin ? 'admin' : identity.name;
            await (0, _asset_registry_js_1.deleteAssetMeta)(id);
            await (0, _audit_js_1.recordAudit)({
                domain: 'content', actor, action: 'image.delete',
                entityType: 'image', entityId: id, meta: { category: cat },
            });
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
