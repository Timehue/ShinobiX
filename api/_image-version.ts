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
 * a `v` the category has already reached as `immutable` for a year (see
 * isPublishedImageVersion). A version only moves when the bytes behind an
 * existing id in that category change or go (see bumpImageVersion), so
 * unchanged art is never re-requested at all.
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
 * afterwards nothing is re-requested until art is actually replaced or removed.
 * That is rare, and the bump is scoped to the touched category, so a pet replace
 * leaves jutsu / item / card art alone. A brand-new image does not bump at all
 * (since the 2026-10 shared-row split), so a new player's avatar leaves every
 * other avatar's URL alone.
 *
 * ── Failure behaviour ───────────────────────────────────────────────────────
 *
 * Every function here fails soft to "no version", which degrades exactly to the
 * old 300s revalidation. A bump that fails cannot break an upload; a read that
 * fails cannot break a manifest or an image. The one thing that must never
 * happen is serving `immutable` under a URL that can later stand for other
 * bytes. That rules out a version the client cannot distinguish (hence
 * {@link isValidImageVersion}, and a read failure omitting the field rather
 * than guessing `0`). It also rules out a version the category has not reached
 * yet (hence {@link isPublishedImageVersion}).
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
 * Has the category already reached `requested`? `/api/img` serves a version
 * immutable only if it has.
 *
 * A version above the counter has never been handed out, so no client can hold
 * it legitimately. It is, however, exactly the URL the category's next replace
 * will hand out. Served immutable, one request for it (a typo, a crawler,
 * anyone) would pin today's bytes under that URL at the edge for a year, and
 * players would not see the replacement art in that time. A version at or
 * below the counter is safe: it is answered with bytes at least as new as the
 * generation it names, and the next replace moves the manifest to a different
 * URL.
 *
 * `current` is null when the counter could not be read. That means unknown,
 * not zero, so no version counts. The comparison is exact, because a 20-digit
 * `requested` is past the point where a Number can tell neighbouring versions
 * apart.
 */
export function isPublishedImageVersion(requested: string, current: string | null): boolean {
    return isValidImageVersion(requested) && isValidImageVersion(current) && BigInt(requested) <= BigInt(current);
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
 * Call this only when a cached URL could hold other bytes for the id: a
 * replace, a delete, an upload over an id the frozen legacy rows still serve,
 * or the server-reset portrait reseed (api/images.ts, api/admin/server-reset.ts).
 * A brand-new id needs no bump, because no client can have cached it, and a
 * bump would re-key every other image in the category. Nothing that only reads
 * may bump; api/img.ts never does.
 *
 * Best-effort by contract — an image write is authoritative whether or not the
 * counter moves. A missed bump costs at most one stale-until-next-bump window,
 * which is the behaviour that shipped for the whole life of the endpoint. Since
 * new ids stopped bumping, that window lasts until the next replace or delete
 * in the category, so a miss is logged.
 */
export async function bumpImageVersion(
    cat: string,
    opts: { kv?: VersionKv } = {},
): Promise<void> {
    const store = opts.kv ?? kv;
    try {
        await store.incr(imageVersionKey(cat));
    } catch (error) {
        // best-effort — never fail an upload or delete over a cache hint
        console.warn(`[image-version] bump failed for ${cat}; cached URLs keep the old art until the next bump:`,
            error instanceof Error ? error.message : error);
    }
}
