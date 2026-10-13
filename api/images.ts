import type { VercelRequest, VercelResponse } from './_vercel.js';
import { kv, type KvLike } from './_storage.js';
import { cors, parseJsonBody, safeName } from './_utils.js';
import { authedPlayerOrAdmin, isAdmin, isFullAdmin } from './_auth.js';
import { writeAssetMeta, deleteAssetMeta, imageFormat, assetMetaKey } from './_asset-registry.js';
import { recordAudit } from './_audit.js';
import { r2ReadEnabled, r2WriteEnabled, putImage, deleteImage } from './_r2.js';
import { bumpImageVersion, readImageVersion } from './_image-version.js';
import { enforceRateLimitKv } from './_ratelimit.js';
import { cachedFor, invalidateProcCache } from './_proc-cache.js';

/*
 * Player upload budget. Every POST writes an image row of up to 3 MB, and a
 * fresh id keeps that row for good, so an unlimited loop over fresh `pet:<id>`
 * ids is a disk-fill and DB-load vector (the 2026-09-19 outage class).
 * Sized for real creation flows: a Bloodline Maker save republishes the bloodline
 * plus every jutsu icon at once, so the burst allows several full edits. The IP
 * backstop is tightened so new (guest) accounts on one address do not each mint a
 * fresh allowance. Admins are exempt. This bounds a single actor; it is not a byte
 * quota (that would need a storage change).
 */
export const IMAGE_UPLOAD_BURST_LIMIT = 40;
export const IMAGE_UPLOAD_BURST_WINDOW_MS = 10 * 60_000;
export const IMAGE_UPLOAD_DAILY_LIMIT = 120;
const IMAGE_UPLOAD_DAY_MS = 24 * 60 * 60_000;
const IMAGE_UPLOAD_IP_BACKSTOP = 3;

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
export function isUnsafeImageUrlHost(rawHost: string): boolean {
    let host = rawHost.toLowerCase().trim();
    if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1); // URL.hostname brackets IPv6
    if (!host) return true;

    // localhost + common internal / mDNS TLDs.
    if (host === 'localhost' || host.endsWith('.localhost')) return true;
    if (/\.(local|internal|lan|home|corp|intranet)$/.test(host)) return true;

    // IPv6 literals: loopback / link-local (fe80::/10) / unique-local (fc00::/7).
    if (host.includes(':')) {
        if (host === '::1' || host === '::') return true;
        if (host.startsWith('fe80:') || host.startsWith('fc') || host.startsWith('fd')) return true;
        return false; // other IPv6 literals are global
    }

    // Bare single-label host (e.g. 'router', 'intranet') — never a public image
    // host; resolves internally on most networks.
    if (!host.includes('.')) return true;

    // Numeric / hex-obfuscated IPv4 (e.g. '2130706433', '0x7f000001') — classic
    // SSRF bypass; no legitimate public image host is a bare number.
    if (/^[0-9]+$/.test(host) || /^0x[0-9a-f]+$/.test(host)) return true;

    // Dotted IPv4 private / loopback / link-local / CGNAT ranges.
    const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (m) {
        const a = Number(m[1]), b = Number(m[2]);
        if (a === 0 || a === 127) return true;                 // this-host / loopback
        if (a === 10) return true;                             // 10.0.0.0/8
        if (a === 192 && b === 168) return true;               // 192.168.0.0/16
        if (a === 169 && b === 254) return true;               // link-local 169.254.0.0/16
        if (a === 172 && b >= 16 && b <= 31) return true;      // 172.16.0.0/12
        if (a === 100 && b >= 64 && b <= 127) return true;     // CGNAT 100.64.0.0/10
    }

    return false;
}

export function isValidImageString(s: string): boolean {
    if (s.length > MAX_IMAGE_BYTES) return false;
    // Accept ONLY raster-image data URLs (png/jpeg/webp/gif) or http(s) URLs.
    // SVG is intentionally rejected: SVG can carry <script> tags. The current
    // client only ever renders avatar/pet/jutsu images via <img src>, which
    // browsers treat as opaque raster — so SVG is technically safe today, but
    // it's a XSS time-bomb the moment any future code uses an image URL in
    // dangerouslySetInnerHTML / <object> / <iframe>. Better to lock it down
    // now than to discover it later.
    if (/^data:image\/(png|jpe?g|webp|gif);base64,/i.test(s)) return true;
    if (/^https?:\/\//i.test(s)) {
        // External URL — allow only public hosts (block internal SSRF targets).
        try {
            return !isUnsafeImageUrlHost(new URL(s).hostname);
        } catch {
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
export function base64DecodedByteLength(dataUrl: string): number {
    const comma = dataUrl.indexOf(',');
    const b64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
    const len = b64.length;
    if (len === 0) return 0;
    const pad = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
    return Math.floor((len * 3) / 4) - pad;
}

// Decode a `data:image/<type>;base64,<payload>` URL into its mime + raw bytes.
// Returns null for anything that isn't a base64 image data URL (e.g. an external
// http(s) URL, which has no bytes to store). Used by the R2 dual-write + backfill
// so image bytes can be served from object storage instead of Postgres.
export function decodeBase64Image(s: string): { mime: string; buf: Buffer } | null {
    const m = /^data:(image\/[a-z0-9+.-]+);base64,(.*)$/is.exec(s);
    if (!m) return null;
    try {
        const buf = Buffer.from(m[2], 'base64');
        return buf.length > 0 ? { mime: m[1].toLowerCase(), buf } : null;
    } catch {
        return null;
    }
}

// Returns an error string if the avatar image is unacceptable, else null.
export function avatarImageReject(image: string): string | null {
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
const catKey = (cat: string) => `shared:images:${cat}`;

// Per-category hash keys: before the shared-row split (below) every upload
// wrote its field here. HSET is atomic per field, which ended the
// GET→modify→SET race that let concurrent uploads overwrite each other. On the
// retired cPanel disk overlay, hset was a JSON-file RMW. There, parallel
// publishes still dropped each other's ids from this manifest while staying
// servable via their shared:img:<id> keys. That is the likely source of the
// "orphans" the 2026-10-13 audit found. Since the split, uploads no longer
// write these rows.
const catHashKey = (cat: string) => `shared:imgfields:${cat}`;
export { catHashKey as legacyHashKey, catKey as legacyBlobKey };

/*
 * The shared-row split (docs/SHARED_HASH_ROW_SPLIT_PLAN.md).
 *
 * One image is one row, `shared:img:<id>` (the id is already "<cat>:<key>").
 * Since the split, that row is the ONLY place an upload writes image bytes, and
 * its key is what lists the image: a manifest is the per-image keys of the
 * category's prefixes, plus the ids the frozen legacy rows still hold. The legacy
 * rows (the hash `shared:imgfields:<cat>` and the blob `shared:images:<cat>`) are
 * no longer written by uploads. Postgres rewrites a jsonb row whole on every
 * write, and those rows are 9-16 MB: every new character's avatar used to rewrite
 * the whole avatar hash. Deletes still remove ids from them, and readers fall
 * back to them for an id that has no row of its own.
 */
export const PER_IMAGE_PREFIX = 'shared:img:';
export const perImageKey = (id: string) => `${PER_IMAGE_PREFIX}${id}`;

/**
 * Rollback lever (plan §3.8): IMAGE_LEGACY_HASH_WRITE=1 restores the pre-split
 * upload path, which also rewrites the category hash. Off by default, and never
 * a rollout step.
 */
export function legacyHashWriteEnabled(): boolean {
    return process.env.IMAGE_LEGACY_HASH_WRITE === '1';
}

/**
 * The bytes the frozen legacy rows hold for an id: the hash first, then the
 * blob, then (for leader portraits uploaded before 'leader' was a category) the
 * misc hash. Empty values are tombstones, never images.
 */
export function legacyImageValue(
    id: string,
    hash: Record<string, string> | null,
    blob: Record<string, string> | null,
    legacyMisc: Record<string, string> | null = null,
): string | null {
    const candidates = [hash?.[id], blob?.[id], id.startsWith('leader:') ? legacyMisc?.[id] : undefined];
    return candidates.find((value): value is string => typeof value === 'string' && value.length > 0) ?? null;
}

export const KNOWN_PREFIXES: Readonly<Record<string, string>> = {
    avatar:    'avatar',
    pet:       'pet',
    jutsu:     'jutsu',
    item:      'item',
    card:      'card',
    event:     'event',
    bloodline: 'bloodline',
    vn:        'event',   // visual-novel pages share the event category
    ai:        'ai',
    // Hollow Gate Shrine assets: backgrounds + tile/scene illustrations + intro VN pages
    // ride under their own 'shrine' bucket; world-map landmarks (like the Hollow Gate POI)
    // ride under 'landmark'. Without these, both would fall into 'misc' and the bulk GET
    // (which only walks KNOWN_CATEGORIES) would never return them.
    shrine:    'shrine',
    landmark:  'landmark',
    // Village leadership portraits (kage / elders), shown in each village's
    // Town Hall. The client publishes `leader:<village>:kage` /
    // `leader:<village>:elder:<n>`. Without this entry these fell into 'misc'
    // (so the bulk GET, which only walks KNOWN_CATEGORIES, never returned them).
    // Admin-only — see ADMIN_ONLY_PREFIXES. (audit #16)
    leader:    'leader',
    // Pet BATTLE-ART slots the renderer already reads from sharedImages:
    // `petbody:<id>` (transparent full-body battle sprite — HD-2D coliseum +
    // the DOM full-body standee), `petsheet:<id>` (baked animation strip) and
    // `petlayers:<id>:<band>` (depth-sliced 2.5D parallax). Riding the 'pet'
    // category means loadCategory('pet')'s id manifest returns them, so the
    // client hydrates them with no client changes. Without these entries they
    // fell into 'misc', which the client never loads. Deliberately NOT
    // admin-only — exact parity with 'pet' portraits (same bounded cosmetic
    // exposure; see the pet ownership note in ownershipReject).
    petbody:   'pet',
    petsheet:  'pet',
    petlayers: 'pet',
};
const KNOWN_CATEGORIES = Array.from(new Set(Object.values(KNOWN_PREFIXES)));

/** Manifest memo lifetime: the edge already serves these for max-age=60. */
export const MANIFEST_CACHE_TTL_MS = 60_000;

/** Categories an image write can target (unknown ids fall into 'misc'). */
export function isManifestCategory(cat: string): boolean {
    return cat === 'misc' || KNOWN_CATEGORIES.includes(cat);
}

// The memo key embeds the category's image version, which a replace or a
// delete bumps. (A brand-new id does not bump; its upload drops this process's
// memo instead, see forgetImageLists.) A superseded key is never read again,
// and the process cache has no eviction, so each one would keep a full id list
// until restart (players can bump versions by replacing their avatar). Holding
// at most ONE live key per category drops the old list the moment the version
// moves; categories are a fixed set.
// A version read that failed (null) is a blip, not a newer version: its key
// lives in a separate slot, so it never evicts the real list (which would force
// a full rebuild the moment the read recovers).
function versionedCacheKeys(namespace: string) {
    const live = new Map<string, string>();
    const degradedSlots = new Map<string, string>();
    const keyFor = (cat: string, version: string | number | null, miscVersion: string | number | null): string => {
        const key = `${namespace}:${cat}:${version ?? '-'}:${miscVersion ?? '-'}`;
        // Only `leader` reads a misc version; elsewhere its null is normal.
        const degraded = version === null || (cat === 'leader' && miscVersion === null);
        const slots = degraded ? degradedSlots : live;
        const previous = slots.get(cat);
        if (previous && previous !== key) invalidateProcCache(previous);
        slots.set(cat, key);
        return key;
    };
    /** Drop whatever this namespace has memoised for the category. */
    const forget = (cat: string): void => {
        for (const slots of [live, degradedSlots]) {
            const key = slots.get(cat);
            if (key !== undefined) invalidateProcCache(key);
        }
    };
    return Object.assign(keyFor, { forget });
}

export const manifestCacheKey = versionedCacheKeys('images:manifest');
const legacyIdsCacheKey = versionedCacheKeys('images:legacy-ids');

/**
 * Drop this process's memoised id lists for a category right after an image
 * write here (Railway runs one process). A replace or a delete also bumps the
 * version, which re-keys them. This covers the two cases the version cannot:
 * a brand-new id, which does not bump, and a bump that did not land (bumps are
 * best-effort), which would otherwise keep a deleted image listed for up to
 * the legacy memo's hour. The legacy-row list goes too only when the write
 * touched those rows, so an upload keeps it.
 */
export function forgetImageLists(cat: string, opts: { legacyRows?: boolean } = {}): void {
    manifestCacheKey.forget(cat);
    if (opts.legacyRows) legacyIdsCacheKey.forget(cat);
}

/**
 * How long the frozen legacy rows' id list is reused. Uploads no longer write
 * those rows. A delete or the rollback lever does, and both bump the category
 * version, which is part of the memo key. The rollback write-back also does,
 * without a bump, but it only adds ids the key scan already lists. So the
 * 9-16 MB rows are read at most about once an hour per category instead of
 * after every upload.
 */
export const LEGACY_IDS_CACHE_TTL_MS = 60 * 60_000;

class ManifestUnavailableError extends Error {
    constructor() {
        super('image index temporarily unavailable');
        this.name = 'ManifestUnavailableError';
    }
}

type ReadTimeout = <T>(p: Promise<T | null>, ms?: number) => Promise<T | null>;

const readNow: ReadTimeout = (read) => read;

type CategoryVersions = { version: string | null; miscVersion: string | null };

/** A category's image version, plus misc's for `leader`, whose lists also read the misc hash. */
async function readCategoryVersions(cat: string): Promise<CategoryVersions> {
    const [version, miscVersion] = await Promise.all([
        readImageVersion(cat),
        cat === 'leader' ? readImageVersion('misc') : Promise.resolve(null),
    ]);
    return { version, miscVersion };
}

/** The id prefixes stored under a category, or null for `misc` (every unknown prefix). */
export function categoryPrefixes(cat: string): string[] | null {
    if (cat === 'misc') return null;
    return Object.entries(KNOWN_PREFIXES)
        .filter(([, category]) => category === cat)
        .map(([prefix]) => prefix)
        .sort();
}

/**
 * The ids in this category that have a per-image row, listed by key prefix
 * (`shared:img:<prefix>:*`): a range scan of the key index that never reads a
 * value.
 */
export async function scanCategoryIds(cat: string, store: Pick<KvLike, 'keys'> = kv): Promise<string[]> {
    const prefixes = categoryPrefixes(cat);
    const patterns = prefixes === null
        ? [`${PER_IMAGE_PREFIX}*`]
        : prefixes.map((prefix) => `${PER_IMAGE_PREFIX}${prefix}:*`);
    const ids = new Set<string>();
    for (const pattern of patterns) {
        for (const key of await store.keys(pattern)) {
            if (!key.startsWith(PER_IMAGE_PREFIX)) continue;
            const id = key.slice(PER_IMAGE_PREFIX.length);
            // `misc` scans every per-image row and keeps the ones it owns. For a
            // named prefix this check changes nothing.
            if (id && categoryFromId(id) === cat) ids.add(id);
        }
    }
    return [...ids].sort();
}

/**
 * The id list behind `GET /api/images?cat=<cat>&ids=1`: every per-image row of
 * the category (a key scan), plus every id the frozen legacy rows still hold.
 * Keys only, never the multi-MB image payloads. Null when any read failed (NOT
 * empty), so a caller never serves or caches a silently incomplete manifest.
 *
 * With `versions`, the legacy part is memoised per category version for an hour
 * (LEGACY_IDS_CACHE_TTL_MS), since those rows now change only on a version bump.
 */
export async function buildManifestIds(
    cat: string,
    withTimeout: ReadTimeout,
    versions?: CategoryVersions,
): Promise<string[] | null> {
    const [legacyIds, scannedIds] = await Promise.all([
        legacyManifestIds(cat, withTimeout, versions),
        withTimeout(scanCategoryIds(cat).catch(() => null)),
    ]);
    if (legacyIds === null || scannedIds === null) return null;
    return Array.from(new Set([...legacyIds, ...scannedIds]));
}

/**
 * A known category's manifest, memoised per (category, version) for
 * MANIFEST_CACHE_TTL_MS, with the versions it was built under. `ids` is null
 * when a read failed, and that is never cached.
 */
async function memoisedManifest(
    cat: string,
    withTimeout: ReadTimeout,
): Promise<{ ids: string[] | null; versions: CategoryVersions }> {
    const versions = await readCategoryVersions(cat);
    try {
        const ids = await cachedFor(
            manifestCacheKey(cat, versions.version, versions.miscVersion),
            MANIFEST_CACHE_TTL_MS,
            async () => {
                const built = await buildManifestIds(cat, withTimeout, versions);
                if (built === null) throw new ManifestUnavailableError();
                return built;
            },
        );
        return { ids, versions };
    } catch (error) {
        if (error instanceof ManifestUnavailableError) return { ids: null, versions };
        throw error;
    }
}

/** The frozen legacy rows' id list, memoised when the category version is known. */
async function legacyManifestIds(
    cat: string,
    withTimeout: ReadTimeout,
    versions?: CategoryVersions,
): Promise<string[] | null> {
    const version = versions?.version ?? null;
    const miscVersion = versions?.miscVersion ?? null;
    if (!isManifestCategory(cat) || version === null || (cat === 'leader' && miscVersion === null)) {
        return buildLegacyManifestIds(cat, withTimeout);
    }
    try {
        return await cachedFor(legacyIdsCacheKey(cat, version, miscVersion), LEGACY_IDS_CACHE_TTL_MS, async () => {
            const ids = await buildLegacyManifestIds(cat, withTimeout);
            if (ids === null) throw new ManifestUnavailableError();
            return ids;
        });
    } catch (error) {
        if (error instanceof ManifestUnavailableError) return null;
        throw error;
    }
}

/**
 * Whether the frozen legacy rows still serve this id, so cached
 * /api/img?id=…&v=<version> URLs may hold their bytes. Unknown counts as yes:
 * a needless version bump only costs cache hits, a missed one serves old art.
 */
async function servedByLegacyRows(cat: string, id: string): Promise<boolean> {
    const ids = await legacyManifestIds(cat, readNow, await readCategoryVersions(cat)).catch(() => null);
    return ids === null || ids.includes(id);
}

/** Keys per batched image read, so no single read carries more than ~25 images. */
const IMAGE_READ_CHUNK = 25;

/**
 * Image bytes for these ids of one category: each image's own row first, and
 * the frozen legacy rows only for ids that have no row and that those rows
 * list (read once, only then). Empty legacy fields are tombstones and are left
 * out.
 */
export async function readImageValues(
    cat: string,
    ids: readonly string[],
    withTimeout: ReadTimeout = readNow,
): Promise<Record<string, string>> {
    return (await readImageValuesReport(cat, ids, withTimeout)).values;
}

/**
 * {@link readImageValues}, plus the ids it could not read. A caller with
 * `unread` ids must not let the answer be cached.
 *
 * When a row read times out, that chunk and every later one are left out,
 * never filled from the legacy rows. For an image replaced since the split,
 * those rows hold the OLDER bytes, and the Admin Panel's "recompress" buttons
 * republish whatever full-content mode returns. Reading stops there too, so a
 * struggling database is not asked for the rest. A legacy read that times out
 * leaves its ids out for the same reason: an older copy in another legacy row
 * must not stand in for the newest one.
 *
 * Only ids the legacy rows list (a memoised, keys-only list) send this to
 * those 9-16 MB rows, so an id with no image anywhere never costs that read.
 */
export async function readImageValuesReport(
    cat: string,
    ids: readonly string[],
    withTimeout: ReadTimeout = readNow,
    versions?: CategoryVersions,
): Promise<{ values: Record<string, string>; unread: string[] }> {
    const values: Record<string, string> = {};
    const missing: string[] = [];
    const unread: string[] = [];
    for (let i = 0; i < ids.length; i += IMAGE_READ_CHUNK) {
        const chunk = ids.slice(i, i + IMAGE_READ_CHUNK);
        const rows = await withTimeout(kv.mget<unknown[]>(...chunk.map(perImageKey)));
        // mget always resolves to an array, so null means the read timed out.
        if (rows === null) {
            unread.push(...ids.slice(i));
            break;
        }
        chunk.forEach((id, index) => {
            const value = rows[index];
            if (typeof value === 'string' && value.length > 0) values[id] = value;
            else missing.push(id);
        });
    }
    if (!missing.length) return { values, unread };
    const legacyIds = await legacyManifestIds(cat, withTimeout, versions ?? await readCategoryVersions(cat));
    if (legacyIds === null) {
        unread.push(...missing);
        return { values, unread };
    }
    const listed = new Set(legacyIds);
    const fallback = missing.filter((id) => listed.has(id));
    if (!fallback.length) return { values, unread };
    // An absent row reads as {}, so a null below can only be a timeout.
    const orEmpty = <T extends object>(read: Promise<T | null>): Promise<T> => read.then((value) => value ?? ({} as T));
    const [hash, blob, misc] = await Promise.all([
        withTimeout(orEmpty(kv.hgetall<Record<string, string>>(catHashKey(cat)))),
        withTimeout(orEmpty(kv.get<Record<string, string>>(catKey(cat)))),
        cat === 'leader'
            ? withTimeout(orEmpty(kv.hgetall<Record<string, string>>(catHashKey('misc'))))
            : Promise.resolve({} as Record<string, string>),
    ]);
    if (hash === null || blob === null || misc === null) {
        unread.push(...fallback);
        return { values, unread };
    }
    for (const id of fallback) {
        const value = legacyImageValue(id, hash, blob, misc);
        if (value) values[id] = value;
    }
    return { values, unread };
}

/**
 * Full-content mode for one category: every listed id with its bytes. A known
 * category reuses the memoised manifest and legacy-id list, so a burst of
 * cache-busting requests cannot make Postgres re-list the 9-16 MB legacy rows
 * each time; the bytes come through the storage read cache. Ids a read could
 * not reach (a failure or a timeout) are left out. That is safe only because
 * the handler sends every full-content answer `private, no-store`.
 */
async function fullContent(cat: string, withTimeout: ReadTimeout): Promise<Record<string, string>> {
    const { ids, versions } = isManifestCategory(cat)
        ? await memoisedManifest(cat, withTimeout)
        : { ids: await buildManifestIds(cat, withTimeout), versions: undefined };
    if (ids === null) return {};
    return (await readImageValuesReport(cat, ids, withTimeout, versions)).values;
}

/**
 * The ids the frozen legacy rows hold: keys of the category's hash row and
 * legacy blob (plus `leader:` entries filed under 'misc'). This was the whole
 * manifest before the split. Null when any read failed (NOT empty).
 */
export async function buildLegacyManifestIds(cat: string, withTimeout: ReadTimeout): Promise<string[] | null> {
    // hkeys with a one-deploy-skew fallback: if the remote proxy doesn't know the
    // op yet (rolling deploy), fall back to the old full read. null = both
    // attempts failed (NOT empty).
    const keysOf = async (key: string): Promise<string[] | null> => {
        try { return await kv.hkeys(key, { nonEmptyStrings: true }); } catch { /* old proxy / transient */ }
        try {
            const all = await kv.hgetall<Record<string, string>>(key);
            return all && typeof all === 'object'
                ? Object.entries(all)
                    .filter(([, value]) => typeof value === 'string' && value.length > 0)
                    .map(([id]) => id)
                : [];
        } catch { return null; }
    };
    const [hashKeys, blobKeys, leaderKeys] = await Promise.all([
        withTimeout(keysOf(catHashKey(cat))),
        withTimeout(keysOf(catKey(cat))),
        cat === 'leader'
            ? withTimeout(keysOf(catHashKey('misc'))).then((ks) => (ks === null ? null : ks.filter((k) => k.startsWith('leader:'))))
            : Promise.resolve([] as string[]),
    ]);
    if (hashKeys === null || blobKeys === null || leaderKeys === null) return null;
    return Array.from(new Set([...leaderKeys, ...blobKeys, ...hashKeys]));
}

export function categoryFromId(id: string): string {
    const prefix = id.split(':')[0];
    // Own keys only. A plain lookup resolved `constructor:x`, `toString:x` or
    // `__proto__:x` to an inherited Object.prototype member, not 'misc'. Such an
    // upload skipped the misc cap, sat in no manifest, and bumped a version key
    // named after the function's source text.
    return Object.hasOwn(KNOWN_PREFIXES, prefix) ? KNOWN_PREFIXES[prefix] : 'misc';
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
export function ownershipReject(
    id: string,
    identity: { admin: true } | { admin: false; name: string },
): { status: number; error: string } | null {
    if (identity.admin) return null;
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
        if (safeName(rest) !== identity.name) {
            return { status: 403, error: 'You can only set your own avatar.' };
        }
    }
    if (prefix === 'pet') {
        // pet:<petId>. First-publish ownership can't be proven here (the client
        // publishes optimistically before the autosave persists the new pet), so
        // the static gate stays fail-open — the async first-writer claim below
        // (imageClaimReject) is what stops one player overwriting another's pet
        // art once it has been published.
    }
    return null;
}

// ── First-writer-wins claim on player-created shared image slots ──────────────
//
// The carve-outs above (named weapons/armor, custom bloodline + its jutsus, pet
// art) let ANY authed player WRITE these ids, because ownership can't be proven
// at first publish: the client publishes optimistically before the debounced
// autosave persists the asset to save:<name>. That left an overwrite hole — the
// ids are discoverable (a custom bloodline's UUID rides the public
// /api/bloodlines/list gallery), so a player who learned another's id could
// replace that image for everyone who views it.
//
// First-writer-wins closes it WITHOUT breaking the optimistic first publish: the
// FIRST authed player to publish an id atomically CLAIMS it, and every later
// write to that id must come from the same player (or an admin). A fresh forge /
// pet / bloodline mints a brand-new random id no one else holds, so the real
// creator always wins the claim, and an attacker can't pre-claim an id they
// can't yet know. Item/bloodline LORE is unaffected — it lives in the
// owner-gated save (api/save/[name].ts), never in this endpoint.

// Exactly the player-created carve-outs above. avatar (already name-gated), misc
// (per-player capped) and the admin-only prefixes are governed by ownershipReject
// and don't take a claim.
export function isPlayerClaimableImageId(id: string): boolean {
    const colon = id.indexOf(':');
    if (colon < 0) return false;
    const prefix = id.slice(0, colon).toLowerCase();
    const rest = id.slice(colon + 1);
    if (prefix === 'item') return PLAYER_NAMED_ITEM_RE.test(rest);
    if (prefix === 'bloodline' || prefix === 'jutsu') return PLAYER_UUID_RE.test(rest);
    return prefix === 'pet' || prefix === 'petbody' || prefix === 'petsheet' || prefix === 'petlayers';
}

const imgOwnerKey = (id: string) => `img-owner:${id}`;

// Returns an HTTP reject if `identity` may NOT write/replace this player-owned
// image slot, else null. On POST (claim !== false) it atomically claims an
// unowned slot for the first writer; on DELETE (claim: false) it only checks an
// existing claim. Admins, non-claimable ids, and still-unclaimed (legacy) slots
// pass through — so a first-time creator is never blocked.
export async function imageClaimReject(
    id: string,
    identity: { admin: true } | { admin: false; name: string },
    opts?: { claim?: boolean },
): Promise<{ status: number; error: string } | null> {
    if (identity.admin) return null;
    if (!isPlayerClaimableImageId(id)) return null;
    const key = imgOwnerKey(id);
    if (opts?.claim !== false) {
        // Atomic first-writer claim — succeeds only when the slot is unowned, so
        // two racing first-writers can't both win. If we set it, we own it.
        if ((await kv.set(key, identity.name, { nx: true })) === 'OK') return null;
    }
    const owner = await kv.get<string>(key);
    if (!owner) return null;                  // unclaimed legacy slot — allow
    if (owner === identity.name) return null; // owner re-uploading / editing
    return { status: 403, error: 'This image belongs to another player.' };
}

/** Admin bulk removal limit per request. */
export const BATCH_DELETE_MAX = 300;

/** `DELETE /api/images` with `{ ids: [...] }`: validated, de-duplicated ids. */
export function batchDeleteIds(body: unknown): string[] | { error: string } {
    const ids = (body as { ids?: unknown } | null)?.ids;
    if (!Array.isArray(ids) || !ids.length) return { error: 'Expected ids: a non-empty array.' };
    if (ids.length > BATCH_DELETE_MAX) return { error: `At most ${BATCH_DELETE_MAX} ids per request.` };
    if (!ids.every((id) => typeof id === 'string' && id.length > 0 && id.length <= 256 && id.includes(':')))
        return { error: 'Every id must be "<category>:<key>" and at most 256 characters.' };
    return [...new Set(ids as string[])];
}

type BatchImageStore = Pick<typeof kv, 'hdel' | 'del' | 'get' | 'set'>;

/**
 * Remove many images with ONE rewrite of each shared record. A single DELETE
 * rewrites the whole category hash and legacy bundle (several MB each) for one
 * image; 253 of them in a row filled the database disk on 2026-09-19. Storage
 * objects go first, as in the single path, and an image whose object could not
 * be removed keeps its database record so a retry can finish it.
 */
export async function removeImagesBatch(ids: readonly string[], deps: {
    store: BatchImageStore;
    removeFromStorage?: (id: string) => Promise<boolean>;
    bumpVersion: (cat: string) => Promise<void>;
    audit: (entry: Parameters<typeof recordAudit>[0]) => Promise<unknown>;
    actor: string;
    concurrency?: number;
}): Promise<{ removed: string[]; failed: { id: string; reason: string }[] }> {
    const failed: { id: string; reason: string }[] = [];
    let removable = [...new Set(ids)];
    if (deps.removeFromStorage) {
        const ok = new Set<string>();
        let next = 0;
        await Promise.all(Array.from({ length: Math.min(deps.concurrency ?? 8, removable.length) }, async () => {
            while (next < removable.length) {
                const id = removable[next++];
                if (await deps.removeFromStorage!(id).catch(() => false)) ok.add(id);
                else failed.push({ id, reason: 'Image storage removal failed; kept for retry.' });
            }
        }));
        removable = removable.filter((id) => ok.has(id));
    }
    const byCategory = new Map<string, string[]>();
    for (const id of removable) byCategory.set(categoryFromId(id), [...(byCategory.get(categoryFromId(id)) ?? []), id]);
    for (const [cat, catIds] of byCategory) {
        await deps.store.hdel(catHashKey(cat), ...catIds);
        // Leader portraits from before 'leader' was a category may also sit in
        // the misc hash, which the leader manifest and /api/img read too.
        if (cat === 'leader') await deps.store.hdel(catHashKey('misc'), ...catIds);
        const blob = await deps.store.get<Record<string, string>>(catKey(cat));
        if (blob && catIds.some((id) => Object.hasOwn(blob, id))) {
            const rest = { ...blob };
            for (const id of catIds) delete rest[id];
            if (Object.keys(rest).length) await deps.store.set(catKey(cat), rest);
            else await deps.store.del(catKey(cat));
        }
    }
    // Per-image rows after the legacy rows and before the version bump, so a
    // manifest built under the new version cannot still list a removed image.
    // A failure fails the whole request; a retry repeats every step harmlessly.
    if (removable.length) await deps.store.del(...removable.flatMap((id) => [perImageKey(id), imgOwnerKey(id), assetMetaKey(id)]));
    for (const [cat, catIds] of byCategory) {
        forgetImageLists(cat, { legacyRows: true });
        if (cat === 'leader') forgetImageLists('misc', { legacyRows: true });
        await deps.bumpVersion(cat);
        await deps.audit({ domain: 'content', actor: deps.actor, action: 'image.delete.batch', entityType: 'image', entityId: `${cat}:*`, meta: { category: cat, count: catIds.length, ids: catIds } });
    }
    return { removed: removable, failed };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();

    if (req.method === 'GET') {
        try {
            const cat = typeof req.query.cat === 'string' ? req.query.cat.trim() : '';

            // `?cat=<cat>&ids=1` is the id manifest every client loads. It is
            // public and cached at the edge. Any other GET is full-content mode,
            // which sends every image's bytes: up to ~18 MB for one category, and
            // every category when there is no `cat`. Only admin tools and scripts
            // use it, so it needs an admin credential. Its answer is `private,
            // no-store`, because Cloudflare caches /api/images*, and a public
            // answer would replay an admin's bytes to anyone. The refusal is a 403,
            // never a 401: the client counts 401s on player requests toward its
            // session-expired prompt (shinobij.client/src/authFetch.ts).
            if (cat && req.query.ids) {
                res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=120');
            } else {
                res.setHeader('Cache-Control', 'private, no-store');
                if (!isAdmin(req)) {
                    return res.status(403).json({ error: 'Full image content is admin-only. Load ?cat=<category>&ids=1 and /api/img instead.' });
                }
            }

            // Helper: read a kv value with a per-call timeout so one slow read
            // never hangs the whole request. 18s per KV call — under both the pg
            // pool's statement timeout (PG_STATEMENT_TIMEOUT_MS, default 30s) and
            // the Supabase REST fallback's 20s abort, so Promise.race fires first.
            const withTimeout = <T>(p: Promise<T | null>, ms = 18_000): Promise<T | null> =>
                Promise.race([p, new Promise<null>((resolve) => setTimeout(() => resolve(null), ms))]);

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
                    // Every client load asks for ~8 of these manifests, and the
                    // 2026-10-12 load test showed them among the slowest DB reads
                    // under load. The id list changes when a write bumps the
                    // category version (a replace, a delete, a batch delete, a
                    // server reset), and also when a brand-new image gets its own
                    // row, which does not bump but drops this process's memo
                    // (forgetImageLists). So it is memoised per (category,
                    // version) for the same 60 s the edge already allows
                    // (Cache-Control max-age=60). Only known categories are
                    // cached, so a request cannot mint unbounded cache entries; a
                    // failed read is never cached.
                    if (isManifestCategory(cat)) {
                        const { ids, versions } = await memoisedManifest(cat, withTimeout);
                        if (ids === null) {
                            res.setHeader('Cache-Control', 'no-store');
                            return res.status(503).json({ error: 'image index temporarily unavailable' });
                        }
                        const { version } = versions;
                        if (req.query.ver) return res.status(200).json(version === null ? { ids } : { version, ids });
                        return res.status(200).json(ids);
                    }
                    const ids = await buildManifestIds(cat, withTimeout);
                    if (ids === null) {
                        // Storage unavailable — make the client retry rather than
                        // caching/running with a silently incomplete manifest.
                        res.setHeader('Cache-Control', 'no-store');
                        return res.status(503).json({ error: 'image index temporarily unavailable' });
                    }
                    // `?ver=1` opts into the versioned shape so this endpoint's
                    // long-standing bare-array contract is untouched for anything
                    // still asking the old way (a CDN-cached client, admin tooling).
                    // The version lets the client mint immutable /api/img URLs —
                    // see api/_image-version.ts for why it is per-category. A null
                    // read degrades to the unversioned URL, i.e. today's behaviour.
                    if (req.query.ver) {
                        const version = await readImageVersion(cat);
                        return res.status(200).json(version === null ? { ids } : { version, ids });
                    }
                    return res.status(200).json(ids);
                }

                // Full-content mode (admins only, see above): every listed id
                // with its bytes. Each image's own row wins, as on /api/img; the
                // legacy rows fill only ids with no row (leader portraits filed
                // under 'misc' included, audit #16).
                return res.status(200).json(await fullContent(cat, withTimeout));
            }

            // No category param: every category's full content (admins only,
            // see above), one category at a time in parallel. 'leader' includes
            // the portraits still filed under 'misc'.
            const categoryEntries = await Promise.all(KNOWN_CATEGORIES.map((category) => fullContent(category, withTimeout)));
            return res.status(200).json(Object.assign({}, ...categoryEntries));
        } catch (err) {
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
        const identity = await authedPlayerOrAdmin(req);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        try {
            const parsed = parseJsonBody(req.body);
            if (!parsed.ok) return res.status(400).json({ error: parsed.error });
            const { id, image } = parsed.body as { id?: string; image?: string };
            if (!id || typeof image !== 'string') return res.status(400).json({ error: 'Missing id or image.' });
            if (id.length > 256) return res.status(400).json({ error: 'Image id too long.' });
            if (!isValidImageString(image)) {
                return res.status(400).json({ error: 'Image must be a valid data URL or http(s) URL under 3 MB.' });
            }
            // Ownership: non-admins can't overwrite admin-prefixed images
            // (jutsu/item/event/etc) and can only write avatar:<their-name>.
            const reject = ownershipReject(id, identity);
            if (reject) return res.status(reject.status).json({ error: reject.error });

            // Charged after the cheap validation above, so a malformed or
            // forbidden request never spends the player's budget — but BEFORE the
            // claim below, because claiming is itself a durable write: a player
            // over budget must not keep reserving fresh ids.
            if (!identity.admin) {
                const backstop = { strict: true, ipBackstopMultiplier: IMAGE_UPLOAD_IP_BACKSTOP };
                if (!(await enforceRateLimitKv(req, res, 'image-upload', IMAGE_UPLOAD_BURST_LIMIT, IMAGE_UPLOAD_BURST_WINDOW_MS, identity.name, backstop))) return;
                if (!(await enforceRateLimitKv(req, res, 'image-upload-day', IMAGE_UPLOAD_DAILY_LIMIT, IMAGE_UPLOAD_DAY_MS, identity.name, backstop))) return;
            }

            // First-writer-wins on the player-created carve-outs: a player who
            // didn't publish this id first can't overwrite it (custom bloodline /
            // jutsu / named gear / pet art). The first publish claims the slot.
            const claimReject = await imageClaimReject(id, identity);
            if (claimReject) return res.status(claimReject.status).json({ error: claimReject.error });

            const cat = categoryFromId(id);

            // Avatar hardening (audit #15): inline data URL only + 2 MB decoded
            // cap. Applied after isValidImageString (which would otherwise let a
            // remote http(s) URL or a 3 MB still through for an avatar).
            if (cat === 'avatar') {
                const avReject = avatarImageReject(image);
                if (avReject) return res.status(400).json({ error: avReject });
            }

            // Per-player cap on "misc" (uncategorized) uploads — stops a single
            // account filling the shared bucket. Tracked by uploader; admins exempt.
            const MAX_MISC_PER_PLAYER = 50;
            if (cat === 'misc' && !identity.admin) {
                const counterKey = `upload:misc-count:${identity.name}`;
                const current = Number((await kv.get<number>(counterKey)) ?? 0);
                if (current >= MAX_MISC_PER_PLAYER) {
                    return res.status(429).json({ error: `Per-player misc image cap reached (${MAX_MISC_PER_PLAYER}).` });
                }
                // Best-effort increment; counter resets only on admin tooling.
                await kv.set(counterKey, current + 1).catch(() => undefined);
            }

            if (legacyHashWriteEnabled()) {
                // Rollback lever (plan §3.8): the pre-split path. It rewrites the
                // whole category hash, then the image's own row, and always
                // retires the category's cached URLs.
                await kv.hset(catHashKey(cat), { [id]: image });
                await kv.set(perImageKey(id), image).catch(() => undefined);
                forgetImageLists(cat, { legacyRows: true });
                await bumpImageVersion(cat);
            } else {
                // The image's own row is the only write, and its key is what
                // lists the image. A failure fails the upload, as a failed hash
                // write did before the split.
                const created = (await kv.set(perImageKey(id), image, { nx: true })) === 'OK';
                if (!created) await kv.set(perImageKey(id), image);
                forgetImageLists(cat);
                // Retire cached /api/img?id=…&v=<old> URLs only when they could
                // hold other bytes for THIS id: a replace, or an id the frozen
                // legacy rows still serve. A brand-new id has no cached URL
                // anywhere, so every other image keeps its cache. Before the
                // split, each new character's avatar re-keyed every avatar URL
                // for every player. Best-effort by contract
                // (api/_image-version.ts).
                if (!created || await servedByLegacyRows(cat, id)) await bumpImageVersion(cat);
            }

            // Stage 3 (R2): also dual-write the decoded bytes to R2 so GET /api/img
            // can redirect there instead of reading Postgres (see api/_r2.ts +
            // docs/R2_IMAGE_MIGRATION_PLAN.md). Best-effort + gated: no-op unless
            // the R2 write creds are set, and a failure NEVER fails the upload
            // (Postgres above stays authoritative; the read path falls back to it).
            // Only inline data-URL images have bytes to store — external http(s)
            // URLs are left to the Postgres redirect path.
            if (r2WriteEnabled()) {
                const decoded = decodeBase64Image(image);
                if (decoded) void putImage(id, decoded).catch(() => undefined);
            }

            // Asset registry (Priority 6) + content audit (Priority 8). Both are
            // best-effort and feature-gated (DISABLE_ASSET_META) — they wrap
            // metadata around the write above and can never fail or alter it.
            const actor = identity.admin ? 'admin' : identity.name;
            await writeAssetMeta({ id, category: cat, image, actor });
            await recordAudit({
                domain: 'content', actor, action: 'image.set',
                entityType: 'image', entityId: id,
                meta: { category: cat, format: imageFormat(image) },
            });

            return res.status(200).end();
        } catch (err) {
            console.error('[images]', err);
            return res.status(500).json({ error: 'Internal server error.' });
        }
    }

    if (req.method === 'DELETE') {
        // Used by the admin tooling (atlas picker "clear slot", per-asset
        // "clear image" buttons). POST with empty string used to be the way
        // to nominally delete, but isValidImageString rejected empty strings,
        // so server-side state never actually cleared. This branch removes the
        // image's own row (what lists and serves it since the shared-row
        // split) and its fields in the frozen legacy rows, so reloads no
        // longer resurrect cleared slots.
        const identity = await authedPlayerOrAdmin(req);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        try {
            // Accept the id either as ?id= query param OR JSON body, for
            // flexibility with fetch wrappers that strip DELETE bodies.
            const queryId = typeof req.query.id === 'string' ? req.query.id : '';
            let bodyId = '';
            let batchBody: unknown;
            if (req.body) {
                const parsed = parseJsonBody(req.body);
                if (!parsed.ok) return res.status(400).json({ error: parsed.error });
                const body = parsed.body as { id?: unknown; ids?: unknown };
                if (body && typeof body.id === 'string') bodyId = body.id;
                if (body && typeof body === 'object' && 'ids' in body) batchBody = body;
            }
            if (batchBody !== undefined) {
                if (!identity.admin || !isFullAdmin(req)) return res.status(403).json({ error: 'Batch image removal is for full admins.' });
                const ids = batchDeleteIds(batchBody);
                if (!Array.isArray(ids)) return res.status(400).json(ids);
                for (const id of ids) {
                    const reject = ownershipReject(id, identity);
                    if (reject) return res.status(reject.status).json({ error: `${id}: ${reject.error}` });
                }
                const result = await removeImagesBatch(ids, {
                    store: kv,
                    removeFromStorage: r2ReadEnabled() || r2WriteEnabled() ? (id) => deleteImage(id) : undefined,
                    bumpVersion: (cat) => bumpImageVersion(cat),
                    audit: (entry) => recordAudit(entry),
                    actor: 'admin',
                });
                return res.status(200).json(result);
            }
            const id = queryId || bodyId;
            if (!id) return res.status(400).json({ error: 'Missing id.' });
            if (id.length > 256) return res.status(400).json({ error: 'Image id too long.' });
            // Same ownership rules as POST — players can't HDEL admin-owned
            // assets or other players' avatars.
            const reject = ownershipReject(id, identity);
            if (reject) return res.status(reject.status).json({ error: reject.error });

            // First-writer-wins: a player can only delete a player-created slot
            // they own (read-only check — deleting must not create a claim).
            const claimReject = await imageClaimReject(id, identity, { claim: false });
            if (claimReject) return res.status(claimReject.status).json({ error: claimReject.error });

            // Removing only DB references leaves a live R2 object that /api/img
            // serves before it ever checks the database. Keep the record on a
            // storage failure so the admin can retry the complete removal.
            if ((r2ReadEnabled() || r2WriteEnabled()) && !await deleteImage(id)) {
                return res.status(503).json({ error: 'Image storage removal failed. Nothing was removed from the image library; retry.' });
            }
            const cat = categoryFromId(id);
            // The frozen legacy rows first (free when the id is absent: kv_hdel
            // skips a row that holds none of the fields). A leader portrait from
            // before 'leader' was a category may also sit in the misc hash,
            // which the leader manifest and /api/img read too.
            await kv.hdel(catHashKey(cat), id);
            if (cat === 'leader') await kv.hdel(catHashKey('misc'), id);
            // Also clear the legacy per-cat blob field in case the image
            // lived there (pre-hash-migration uploads). Done BEFORE the version
            // bump: a manifest built under the new version must never still find
            // the id in the blob and cache it (the batch path bumps last too).
            // Own keys only: `in` also sees inherited names, so an admin delete
            // of a colon-less id such as `constructor` would rewrite the whole
            // multi-MB blob for nothing.
            const blob = await kv.get<Record<string, string>>(catKey(cat));
            if (blob && Object.hasOwn(blob, id)) {
                const next = { ...blob };
                delete next[id];
                await kv.set(catKey(cat), next);
            }
            // The image's own row is what lists and serves it, so this removal
            // must land: a failure fails the request, and a retry repeats every
            // step above harmlessly. Also before the bump, for the same reason
            // as the blob.
            await kv.del(perImageKey(id));
            forgetImageLists(cat, { legacyRows: true });
            if (cat === 'leader') forgetImageLists('misc', { legacyRows: true });
            // Retire the immutable URLs that still point at the deleted bytes,
            // for the same reason as the upload path above.
            await bumpImageVersion(cat);
            // Release the ownership claim so a fully-deleted slot is freed.
            await kv.del(imgOwnerKey(id)).catch(() => undefined);
            // Drop the registry metadata + audit the removal (best-effort).
            const actor = identity.admin ? 'admin' : identity.name;
            await deleteAssetMeta(id);
            await recordAudit({
                domain: 'content', actor, action: 'image.delete',
                entityType: 'image', entityId: id, meta: { category: cat },
            });
            return res.status(200).end();
        } catch (err) {
            console.error('[images DELETE]', err);
            return res.status(500).json({ error: 'Internal server error.' });
        }
    }

    return res.status(405).end();
}
