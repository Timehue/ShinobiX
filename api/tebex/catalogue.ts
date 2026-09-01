import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { cors } from '../_utils.js';
import { clientIp } from '../_client-ip.js';
import { TEBEX_HEADLESS_BASE, parseCataloguePrices, type CataloguePrice } from './_basket-core.js';

/*
 * GET /api/tebex/catalogue — what the shard tiers cost THIS buyer.
 *
 * shared/shard-packages.ts is explicit that its `usd` figures are a planning
 * reference and must never be shown as a price: the storefront holds the real
 * one, in the buyer's currency and with their tax applied. Showing $5 to
 * someone who will be charged €5.49 is wrong in most of the world, so the shop
 * asks Tebex what to display and only falls back to the reference figure when
 * this call cannot answer.
 *
 * Public and unauthenticated — it reveals nothing but shop prices, which are
 * public by definition. It grants nothing and takes no money.
 */

const CACHE_TTL_MS = 5 * 60 * 1000;
/** Bounded so a spray of forged addresses cannot grow this without limit. */
const CACHE_MAX_ENTRIES = 500;
const TEBEX_TIMEOUT_MS = 8_000;

const cache = new Map<string, { at: number; prices: CataloguePrice[] }>();

function cached(key: string): CataloguePrice[] | null {
    const hit = cache.get(key);
    if (!hit || Date.now() - hit.at > CACHE_TTL_MS) return null;
    return hit.prices;
}

function remember(key: string, prices: CataloguePrice[]): void {
    if (cache.size >= CACHE_MAX_ENTRIES) {
        // Oldest insertion first — Map preserves insertion order.
        const oldest = cache.keys().next();
        if (!oldest.done) cache.delete(oldest.value);
    }
    cache.set(key, { at: Date.now(), prices });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed.' });

    const token = String(process.env.TEBEX_PUBLIC_TOKEN ?? '').trim();
    // An empty list is the honest answer for an unconfigured store, and the shop
    // renders its reference prices from it. This is not an error state to shout
    // about — it is exactly what a store with no packages yet looks like.
    if (!token) return res.status(200).json({ ok: true, prices: [], reason: 'unconfigured' });

    const ip = clientIp(req as Parameters<typeof clientIp>[0]) ?? '';
    const key = ip || 'default';
    const hit = cached(key);
    if (hit) return res.status(200).json({ ok: true, prices: hit, cached: true });

    try {
        const url = new URL(`${TEBEX_HEADLESS_BASE}/${token}/packages`);
        // Lets Tebex price in the buyer's own currency rather than the store default.
        if (ip) url.searchParams.set('ipAddress', ip);
        const response = await fetch(url, {
            headers: { Accept: 'application/json' },
            signal: AbortSignal.timeout(TEBEX_TIMEOUT_MS),
        });
        if (!response.ok) {
            console.warn('[tebex] catalogue fetch failed', response.status);
            return res.status(200).json({ ok: true, prices: [], reason: 'upstream' });
        }
        const prices = parseCataloguePrices(await response.json());
        remember(key, prices);
        return res.status(200).json({ ok: true, prices });
    } catch (error) {
        // Never fail the shop over a price lookup. The tiers still render from
        // the reference figures, clearly labelled, and checkout shows the truth.
        console.warn('[tebex] catalogue error', (error as Error)?.name);
        return res.status(200).json({ ok: true, prices: [], reason: 'error' });
    }
}
