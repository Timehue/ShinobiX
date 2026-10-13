import type { VercelRequest, VercelResponse } from './_vercel.js';
import { kv } from './_storage.js';
import { cors } from './_utils.js';
import { categoryFromId, legacyBlobKey, legacyHashKey, legacyImageValue, perImageKey } from './images.js';
import { r2ReadEnabled, r2ObjectExists, r2PublicUrl } from './_r2.js';
import { isValidImageVersion } from './_image-version.js';

// Kept here for existing importers; images.ts owns them since the shared-row split.
export { legacyImageValue, perImageKey };

// Phase 2 — per-image binary serving (see
// docs/load-and-refresh-perf-audit-2026-06-08.md).
//
// Replaces shipping ~33MB of base64-in-JSON on cold load. Instead of the client
// pulling 10 giant per-category blobs up front, it fetches ONE image at a time
// from `GET /api/img?id=<cat>:<id>` — each independently CDN- and browser-cached,
// loaded only when a screen actually shows it.
//
// Storage: images live as individual KV keys `shared:img:<cat>:<id>`, e.g.
// shared:img:jutsu:fireball (perImageKey). For an id with no row of its own we
// fall back, READ-ONLY, to the frozen legacy per-category hash/blob. Public +
// unauthenticated, same as the `GET /api/images?cat=<cat>&ids=1` manifest (shared
// art is not secret; only the multi-MB full-content mode there is admin-only).
const IMAGE_READ_TIMEOUT = Symbol('image-read-timeout');

function temporaryImageFailure(res: VercelResponse) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Retry-After', '1');
    return res.status(503).end();
}

// Parse a `data:image/<type>;base64,<payload>` URL into a mime + decoded buffer.
// Returns null for anything that isn't a base64 image data URL.
export function decodeImageDataUrl(s: string): { mime: string; buf: Buffer } | null {
    const m = /^data:(image\/[a-z0-9+.-]+);base64,(.*)$/is.exec(s);
    if (!m) return null;
    try {
        const buf = Buffer.from(m[2], 'base64');
        if (buf.length === 0) return null;
        return { mime: m[1].toLowerCase(), buf };
    } catch {
        return null;
    }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET') return res.status(405).end();

    const id = typeof req.query.id === 'string' ? req.query.id.trim() : '';
    if (!id || id.length > 256 || id.indexOf(':') < 0) {
        res.setHeader('Cache-Control', 'no-store');
        return res.status(400).json({ error: 'Missing or invalid image id (expected "<category>:<key>").' });
    }
    const cat = categoryFromId(id);

    // A caller that supplied `?v=<category version>` is asking for one specific
    // generation of this art, so the answer can never go stale under that URL —
    // a new upload bumps the category and the client asks for a DIFFERENT URL
    // (api/_image-version.ts). Serve it immutable and stop paying a revalidation
    // per image per five minutes. Anything without a usable `v` (an old cached
    // client, admin tooling, a hand-typed URL) keeps the original short TTL.
    const versioned = isValidImageVersion(req.query.v);
    const IMMUTABLE_CACHE = 'public, max-age=31536000, immutable';
    const REVALIDATED_CACHE = 'public, max-age=300, stale-while-revalidate=86400';
    const artCache = versioned ? IMMUTABLE_CACHE : REVALIDATED_CACHE;

    // Stage 3 (R2): when R2 reads are enabled AND this image's bytes exist in R2,
    // redirect straight to the public (Cloudflare-fronted) URL — the browser
    // fetches the bytes from R2, never from Postgres through this function. This
    // removes the DB round-trip that 503s under load and blanks cold portraits.
    // r2ObjectExists HEAD-checks per id/version then caches a hit, so
    // steady-state this is a pure redirect. Any miss (R2 disabled, un-backfilled
    // id, external-URL image, or a HEAD failure) falls through to the existing
    // Postgres path below — so nothing regresses and the fallback stays intact.
    if (r2ReadEnabled()) {
        const imageVersion = versioned ? req.query.v as string : undefined;
        const url = r2PublicUrl(id, imageVersion);
        if (url && (await r2ObjectExists(id, { version: imageVersion }))) {
            res.setHeader('Cache-Control', artCache);
            return res.redirect(302, url);
        }
    }

    // Per-call timeout so one slow KV read can't hang the function.
    const withTimeout = <T>(p: Promise<T | null>, ms = 8_000): Promise<T | null | typeof IMAGE_READ_TIMEOUT> =>
        Promise.race([p, new Promise<typeof IMAGE_READ_TIMEOUT>((resolve) => setTimeout(() => resolve(IMAGE_READ_TIMEOUT), ms))]);

    try {
        // 1. Fast path: the per-image key (one small read).
        const direct = await withTimeout(kv.get<string>(perImageKey(id)));
        if (direct === IMAGE_READ_TIMEOUT) return temporaryImageFailure(res);
        let raw = direct;

        // 2. Fallback, READ-ONLY: the frozen legacy per-category hash/blob, for
        //    an id with no row of its own. Nothing is copied back. Since the
        //    shared-row split, an image's own row is what LISTS it, so a copy
        //    racing an admin delete would bring the deleted image back.
        //    (docs/SHARED_HASH_ROW_SPLIT_PLAN.md §2: every listed id already
        //    has its row; this serves the few the legacy rows alone hold.)
        if (!raw) {
            const [hashResult, blobResult, miscResult] = await Promise.all([
                withTimeout(kv.hgetall<Record<string, string>>(legacyHashKey(cat))),
                withTimeout(kv.get<Record<string, string>>(legacyBlobKey(cat))),
                cat === 'leader'
                    ? withTimeout(kv.hgetall<Record<string, string>>(legacyHashKey('misc')))
                    : Promise.resolve(null),
            ]);
            // A read that timed out may hold the newest legacy copy, so an older
            // one found in another row must not stand in for it, least of all
            // under an immutable URL. The client retries instead.
            if (hashResult === IMAGE_READ_TIMEOUT || blobResult === IMAGE_READ_TIMEOUT || miscResult === IMAGE_READ_TIMEOUT) {
                return temporaryImageFailure(res);
            }
            raw = legacyImageValue(id, hashResult, blobResult, miscResult);
        }

        if (!raw) {
            // Not found. Non-cacheable so a transient miss isn't pinned at the edge.
            res.setHeader('Cache-Control', 'no-store');
            return res.status(404).end();
        }

        // Some non-avatar categories allow a remote http(s) URL instead of an
        // inline data URL — redirect to it (the browser fetches it directly).
        if (/^https?:\/\//i.test(raw)) {
            res.setHeader('Cache-Control', versioned ? IMMUTABLE_CACHE : 'public, max-age=300');
            return res.redirect(302, raw);
        }

        const decoded = decodeImageDataUrl(raw);
        if (!decoded) {
            res.setHeader('Cache-Control', 'no-store');
            return res.status(415).end();
        }

        res.setHeader('Content-Type', decoded.mime);
        // Versioned callers get a year (the URL names the generation); everyone
        // else keeps the original 5-minute serve-then-revalidate. Cloudflare + the
        // browser absorb refreshes; the client only ever fetches the handful of
        // images on the current screen.
        res.setHeader('Cache-Control', artCache);
        return res.status(200).send(decoded.buf);
    } catch (err) {
        console.error('[img]', err);
        return temporaryImageFailure(res);
    }
}
