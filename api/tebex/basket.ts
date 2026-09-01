import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { cors } from '../_utils.js';
import { authedPlayer } from '../_auth.js';
import { clientIp } from '../_client-ip.js';
import { enforceRateLimit } from '../_ratelimit.js';
import {
    TEBEX_HEADLESS_BASE,
    buildAddPackageBody,
    buildCreateBasketBody,
    parseCreatedBasket,
    resolvePurchasable,
} from './_basket-core.js';

/*
 * POST /api/tebex/basket — open a Fate Shard checkout for the signed-in player.
 *
 * The web half of the storefront. The client names a package it wants; this
 * mints a Tebex basket bound to the AUTHENTICATED player, drops the package in,
 * and hands back the basket ident for Tebex.js to open its overlay with. Money
 * is then handled entirely by Tebex, and shards are credited later by
 * api/tebex/webhook.ts — never by anything the browser says came back.
 *
 * ⛔ IDENTITY IS SERVER-SET. The recipient comes from authedPlayer() and is
 * sealed into the basket's `custom` blob, which is what the webhook reads back.
 * The request body chooses a PACKAGE and nothing else. This is the same
 * mint-a-sealed-token shape as expedition-start and raid-start: the client
 * opens the transaction, the server decides what it is and who it is for.
 *
 * This endpoint takes no money and grants no currency, so it is not itself a
 * faucet — the worst a caller can do is create abandoned baskets, which the
 * rate limit bounds.
 */

const BASKET_LIMIT = 10;
const BASKET_WINDOW_MS = 5 * 60 * 1000;
/** A hung storefront call must not hold a request open indefinitely. */
const TEBEX_TIMEOUT_MS = 10_000;

const publicToken = (): string => String(process.env.TEBEX_PUBLIC_TOKEN ?? '').trim();

async function tebexPost(path: string, body: unknown): Promise<{ ok: boolean; status: number; json: unknown }> {
    const response = await fetch(`${TEBEX_HEADLESS_BASE}/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TEBEX_TIMEOUT_MS),
    });
    let json: unknown = null;
    try { json = await response.json(); } catch { json = null; }
    return { ok: response.ok, status: response.status, json };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed.' });

    const playerName = await authedPlayer(req);
    if (!playerName) return res.status(401).json({ error: 'Authentication required.' });
    if (!enforceRateLimit(req, res, 'tebex-basket', BASKET_LIMIT, BASKET_WINDOW_MS, playerName)) return;

    const token = publicToken();
    // Fail closed and SAY SO. An unconfigured storefront is an operator problem,
    // and a shop that renders a dead button teaches players the game is broken.
    if (!token) return res.status(503).json({ error: 'The shop is not available right now.', reason: 'unconfigured' });

    const body = typeof req.body === 'string' ? (() => { try { return JSON.parse(req.body); } catch { return {}; } })() : (req.body ?? {});
    const requestedId = typeof body.packageId === 'string' ? body.packageId.trim() : '';
    if (!requestedId) return res.status(400).json({ error: 'A packageId is required.' });

    // An id we do not sell, or one with no Tebex product behind it yet, is
    // refused rather than substituted. Charging for a package the webhook cannot
    // map back to a shard amount would take money for nothing.
    const resolved = resolvePurchasable(requestedId);
    if (!resolved) return res.status(400).json({ error: 'That package is not for sale.', packageId: requestedId });

    try {
        const created = await tebexPost(
            `${token}/baskets`,
            buildCreateBasketBody({ playerName, ipAddress: clientIp(req as Parameters<typeof clientIp>[0]) ?? undefined }),
        );
        const basket = created.ok ? parseCreatedBasket(created.json) : null;
        if (!basket) {
            console.error('[tebex] basket create failed', created.status, JSON.stringify(created.json).slice(0, 400));
            return res.status(502).json({ error: 'Could not open checkout. Please try again.' });
        }

        const added = await tebexPost(`${token}/${basket.ident}/packages`, buildAddPackageBody(resolved.tebexId));
        if (!added.ok) {
            // An empty basket cannot be paid, so this is a hard failure rather
            // than a checkout the player would find broken on arrival.
            console.error('[tebex] add package failed', basket.ident, added.status, JSON.stringify(added.json).slice(0, 400));
            return res.status(502).json({ error: 'Could not add that package. Please try again.' });
        }

        console.log('[tebex] basket', basket.ident, playerName, requestedId, resolved.kind);
        return res.status(200).json({
            ok: true,
            ident: basket.ident,
            checkoutUrl: basket.checkoutUrl,
            packageId: requestedId,
            // Echoed so the client can show what it is about to charge for
            // without re-deriving it. NOT authoritative for the grant — the
            // webhook reads the catalogue itself.
            shards: resolved.shards,
        });
    } catch (error) {
        // Includes the AbortSignal timeout. Tebex being slow or down is not a
        // player error and must not read as one.
        console.error('[tebex] basket error', (error as Error)?.name, (error as Error)?.message);
        return res.status(502).json({ error: 'The shop is unavailable right now. Please try again shortly.' });
    }
}
