import type { VercelRequest, VercelResponse } from './_vercel.js';
import { kv } from './_storage.js';
import { cors } from './_utils.js';
import { categoryFromId } from './images.js';
import { r2ReadEnabled, r2ObjectExists, r2PublicUrl } from './_r2.js';

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
export const perImageKey = (id: string) => `shared:img:${id}`;
const IMAGE_READ_TIMEOUT = Symbol('image-read-timeout');

export function legacyImageValue(
    id: string,
    hash: Record<string, string> | null,
    blob: Record<string, string> | null,
    legacyMisc: Record<string, string> | null = null,
): string | null {
    const candidates = [hash?.[id], blob?.[id], id.startsWith('leader:') ? legacyMisc?.[id] : undefined];
    return candidates.find((value): value is string => typeof value === 'string' && value.length > 0) ?? null;
}

function temporaryImageFailure(res: VercelResponse) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Retry-After', '1');
    return res.status(503).end();
}

// Per-process guard: bulk-migrate each category's legacy blob into per-image
// keys at most once per instance, so a burst of first-views can't re-fire the
// whole write set. Convergence is still guaranteed because each served image
// also populates its own key (see the fallback below), so even if the bulk pass
// is skipped or partially fails, every served image self-heals individually.
const _bulkMigratedCats = new Set<string>();
// Legacy stores (read-only fallback during migration).
const legacyHashKey = (cat: string) => `shared:imgfields:${cat}`;
const legacyBlobKey = (cat: string) => `shared:images:${cat}`;

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

    // Stage 3 (R2): when R2 reads are enabled AND this image's bytes exist in R2,
    // redirect straight to the public (Cloudflare-fronted) URL — the browser
    // fetches the bytes from R2, never from Postgres through this function. This
    // removes the DB round-trip that 503s under load and blanks cold portraits.
    // r2ObjectExists HEAD-checks once per id per process then caches a hit, so
    // steady-state this is a pure redirect. Any miss (R2 disabled, un-backfilled
    // id, external-URL image, or a HEAD failure) falls through to the existing
    // Postgres path below — so nothing regresses and the fallback stays intact.
    if (r2ReadEnabled()) {
        const url = r2PublicUrl(id);
        if (url && (await r2ObjectExists(id))) {
            res.setHeader('Cache-Control', 'public, max-age=300, stale-while-revalidate=86400');
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

        // 2. Fallback: the legacy per-category hash/blob (pre-migration). On a
        //    hit, lazily copy into per-image keys so subsequent reads are cheap.
        //    Best-effort + async — never block the response on a migration write.
        if (!raw) {
            const [hashResult, blobResult, miscResult] = await Promise.all([
                withTimeout(kv.hgetall<Record<string, string>>(legacyHashKey(cat))),
                withTimeout(kv.get<Record<string, string>>(legacyBlobKey(cat))),
                cat === 'leader'
                    ? withTimeout(kv.hgetall<Record<string, string>>(legacyHashKey('misc')))
                    : Promise.resolve(null),
            ]);
            const legacyTimedOut = hashResult === IMAGE_READ_TIMEOUT
                || blobResult === IMAGE_READ_TIMEOUT
                || miscResult === IMAGE_READ_TIMEOUT;
            const hash = hashResult === IMAGE_READ_TIMEOUT ? null : hashResult;
            const blob = blobResult === IMAGE_READ_TIMEOUT ? null : blobResult;
            const misc = miscResult === IMAGE_READ_TIMEOUT ? null : miscResult;
            raw = legacyImageValue(id, hash, blob, misc);
            if (!raw && legacyTimedOut) return temporaryImageFailure(res);
            if (raw) {
                // Always migrate the served image (guarantees it converges).
                void kv.set(perImageKey(id), raw).catch(() => undefined);
                // Once per process per category, migrate the WHOLE blob so the
                // next request for ANY other image in this category hits the cheap
                // per-image path — turning ~one full-blob read per image into ~one
                // per category. Fire-and-forget; failures self-heal per-image.
                if (!_bulkMigratedCats.has(cat)) {
                    _bulkMigratedCats.add(cat);
                    const legacyLeaders = cat === 'leader'
                        ? Object.fromEntries(Object.entries(misc ?? {}).filter(([key]) => key.startsWith('leader:')))
                        : {};
                    const merged: Record<string, string> = { ...legacyLeaders, ...(blob ?? {}), ...(hash ?? {}) };
                    void Promise.allSettled(
                        Object.entries(merged)
                            .filter(([k, v]) => k !== id && typeof v === 'string' && v.length > 0)
                            .map(([k, v]) => kv.set(perImageKey(k), v)),
                    );
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
    } catch (err) {
        console.error('[img]', err);
        return temporaryImageFailure(res);
    }
}
