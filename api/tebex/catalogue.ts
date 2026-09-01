import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { cors } from '../_utils.js';
import { TEBEX_HEADLESS_BASE, parseCataloguePrices, type CataloguePrice } from './_basket-core.js';

/*
 * GET /api/tebex/catalogue — the storefront's own prices for the shard tiers.
 *
 * shared/shard-packages.ts is explicit that its `usd` figures are a planning
 * reference and must never be shown as a price. This asks the storefront
 * instead, so the listing reflects what Tebex actually has configured rather
 * than a number in our source that can drift from it.
 *
 * ⚠ These are the store's BASE-currency prices, not per-buyer localized ones.
 * Localization was the original intent and is not achievable here — see the
 * `ipAddress` note below. The buyer's real amount, in their currency and with
 * their tax, is shown by Tebex at checkout before they pay.
 *
 * Public and unauthenticated — it reveals nothing but shop prices, which are
 * public by definition. It grants nothing and takes no money.
 */

const CACHE_TTL_MS = 5 * 60 * 1000;
const TEBEX_TIMEOUT_MS = 8_000;

/*
 * ONE entry, not one per visitor. This was keyed by client IP back when the
 * request carried an `ipAddress` parameter and could in principle return a
 * different currency per buyer. That parameter turned out to break the call
 * outright, so every response is now identical — and a per-IP key would only
 * shard one shared answer into hundreds of copies, each missing the cache.
 */
let cache: { at: number; prices: CataloguePrice[] } | null = null;

function cached(): CataloguePrice[] | null {
    if (!cache || Date.now() - cache.at > CACHE_TTL_MS) return null;
    return cache.prices;
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

    const hit = cached();
    if (hit) return res.status(200).json({ ok: true, prices: hit, cached: true });

    try {
        /*
         * ⛔ NO `ipAddress` PARAMETER. It was added here to have Tebex price in
         * the buyer's own currency, and it silently broke the whole call: this
         * endpoint answers 302 whenever the parameter is present, for ANY value
         * — valid IPv4, IPv6, or private range alike — and 200 without it.
         *
         * The failure was invisible from the outside because this route fails
         * soft by design: the shop kept rendering, just with its reference-USD
         * estimates instead of real prices, and the only trace was
         * `reason: 'upstream'` in the response.
         *
         * Prices therefore come back in the store's base currency. Checkout
         * still shows and charges the buyer's own localized amount — Tebex
         * handles that at the till — so the estimate is only ever the listing.
         */
        const url = new URL(`${TEBEX_HEADLESS_BASE}/${token}/packages`);
        const response = await fetch(url, {
            headers: { Accept: 'application/json' },
            signal: AbortSignal.timeout(TEBEX_TIMEOUT_MS),
        });
        if (!response.ok) {
            // Status included: a bare "it failed" is what made the 302 above
            // take a live debugging session to find.
            console.warn('[tebex] catalogue fetch failed', response.status, url.pathname);
            return res.status(200).json({ ok: true, prices: [], reason: 'upstream' });
        }
        const prices = parseCataloguePrices(await response.json());
        cache = { at: Date.now(), prices };
        return res.status(200).json({ ok: true, prices });
    } catch (error) {
        // Never fail the shop over a price lookup. The tiers still render from
        // the reference figures, clearly labelled, and checkout shows the truth.
        console.warn('[tebex] catalogue error', (error as Error)?.name);
        return res.status(200).json({ ok: true, prices: [], reason: 'error' });
    }
}
