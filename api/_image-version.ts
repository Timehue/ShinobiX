/**
 * Per-category cache-busting version for the shared image library.
 *
 * ── The problem this solves ─────────────────────────────────────────────────
 *
 * `GET /api/img?id=<cat>:<key>` served every image with
 * `max-age=300, stale-while-revalidate=86400` on EVERY path — including the R2
 * redirect, which exists precisely so the browser fetches bytes from Cloudflare
 * instead of Postgres. The bytes did come from R2, but the browser still came
 * back to this server for a fresh 302 every five minutes, per image, forever.
 * A screen showing thirty pieces of art costs thirty app-server round trips per
 * player per five minutes, in perpetuity, for art that essentially never changes.
 *
 * The 300s was load-bearing, not lazy: an image id is stable and an admin can
 * replace the art behind one, so the URL alone could not tell new bytes from old.
 *
 * ── The fix ─────────────────────────────────────────────────────────────────
 *
 * Make the URL say which generation of the category it wants. The manifest
 * (`GET /api/images?cat=X&ids=1&ver=1`) hands the client a version alongside the
 * id list; the client emits `/api/img?id=X&v=<version>`; and `/api/img` serves
 * anything carrying a `v` as `immutable` for a year. A version only moves when
 * something in that category is actually written or deleted, so unchanged art is
 * never re-requested at all.
 *
 * ── Why per-CATEGORY and not per-image ──────────────────────────────────────
 *
 * Per-image would be tighter — the asset registry already stores a per-id
 * `contentHash` — but reading it means `keys()` + `mget` over every asset-meta
 * record to build one manifest, and the registry is optional
 * (DISABLE_ASSET_META). A category counter is one small read.
 *
 * The cost of the coarser key is that replacing one pet sprite re-downloads the
 * other pet art as players encounter it. That is still strictly better than what
 * it replaces: today EVERY image is revalidated every five minutes forever;
 * afterwards nothing is re-requested until an admin actually uploads. Uploads are
 * rare admin actions, and the bump is scoped to the touched category, so a pet
 * upload leaves jutsu / item / card art alone.
 *
 * ── Failure behaviour ───────────────────────────────────────────────────────
 *
 * Every function here fails soft to "no version", which degrades exactly to the
 * old 300s revalidation. A bump that fails cannot break an upload; a read that
 * fails cannot break a manifest. The one thing that must never happen is serving
 * `immutable` under a version the client cannot distinguish — hence
 * {@link isValidImageVersion}, and hence a read failure omitting the field
 * rather than guessing `0`.
 */

import { kv, type KvLike } from './_storage.js';

/** Injection seam, matching _asset-registry.ts. Production passes nothing. */
type VersionKv = Pick<KvLike, 'get' | 'incr'>;

/** One counter per image category. */
export const imageVersionKey = (cat: string) => `shared:imgver:${cat}`;

/**
 * Accepted `?v=` shape. Deliberately narrow: `v` is attacker-supplied on a
 * public endpoint and becomes part of the CDN cache key, so an unbounded value
 * would let anyone mint unlimited distinct cache entries for the same image.
 */
const VERSION_RE = /^[0-9]{1,20}$/;

export function isValidImageVersion(value: unknown): value is string {
    return typeof value === 'string' && VERSION_RE.test(value);
}

/**
 * Current version for a category, or `null` when storage is unreachable or the
 * counter has never been bumped.
 *
 * `null` (rather than `'0'`) on failure is deliberate. A guessed `0` would be
 * handed out as a real version, and every client that received it would pin the
 * art under `v=0` for a year. Self-healing would still occur — the next good
 * manifest returns the true version, which is a different URL and therefore a
 * miss — but omitting the field instead keeps the failure mode identical to the
 * pre-versioning behaviour rather than inventing a new one.
 */
export async function readImageVersion(
    cat: string,
    opts: { kv?: VersionKv } = {},
): Promise<string | null> {
    const store = opts.kv ?? kv;
    try {
        const raw = await store.get<number | string>(imageVersionKey(cat));
        if (raw === null || raw === undefined) return '0';
        const n = Math.floor(Number(raw));
        return Number.isFinite(n) && n >= 0 ? String(n) : '0';
    } catch {
        return null;
    }
}

/**
 * Advance a category after a write that changes what an id resolves to.
 *
 * Call this for uploads and deletes ONLY. The lazy legacy→per-image copies in
 * api/img.ts must NOT bump: they move identical bytes between keys, so bumping
 * would invalidate every client's cache for a migration they cannot observe.
 *
 * Best-effort by contract — an image write is authoritative whether or not the
 * counter moves. A missed bump costs at most one stale-until-next-bump window,
 * which is the behaviour that shipped for the whole life of the endpoint.
 */
export async function bumpImageVersion(
    cat: string,
    opts: { kv?: VersionKv } = {},
): Promise<void> {
    const store = opts.kv ?? kv;
    try {
        await store.incr(imageVersionKey(cat));
    } catch {
        // best-effort — never fail an upload or delete over a cache hint
    }
}
