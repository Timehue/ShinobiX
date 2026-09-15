import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { cors, safeName } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { isUnclaimedGuest } from '../_guest-gate.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { parseSettlementRequestId } from '../_settlement-receipts.js';
import { safeLogValue } from '../_safe-log.js';
import { EXCHANGE_FEE_PERCENT, EXCHANGE_LISTING_LIMIT, type ExchangeKind } from '../../shared/sunscar-exchange.js';
import { actOnExchangeListing, createExchangeListing, exchangeSnapshot } from './_exchange.js';
import { ExchangeError } from './_exchange-assets.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    res.setHeader('Cache-Control', 'no-store');
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();
    try {
        let body: Record<string, unknown>;
        try { body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body ?? {}; }
        catch { return res.status(400).json({ error: 'Invalid request.' }); }
        if (!body || Array.isArray(body) || typeof body !== 'object') return res.status(400).json({ error: 'Invalid request.' });
        const player = safeName(String(body.playerName ?? ''));
        if (!player) return res.status(400).json({ error: 'Missing player name.' });
        const identity = await authedPlayerOrAdmin(req, player);
        if (!identity) return res.status(401).json({ error: 'Sign in to use Sunscar Exchange.' });
        if (!identity.admin && identity.name !== player) return res.status(403).json({ error: 'You can only trade for your own account.' });
        if (!identity.admin && await isUnclaimedGuest(player)) return res.status(403).json({ error: 'Link a Google account or set a password to trade at Sunscar Exchange.', guestLocked: true });
        if (!identity.admin && !await enforceRateLimitKv(req, res, 'sunscar-exchange', 30, 60_000, player, { strict: true })) return;
        let listing;
        if (body.action === 'list') {
            const requestId = parseSettlementRequestId(body.requestId);
            if (!requestId) return res.status(400).json({ error: 'A valid listing request ID is required.' });
            listing = await createExchangeListing(player, { requestId, kind: body.kind as ExchangeKind, assetId: String(body.assetId ?? ''), quantity: body.quantity as number, price: body.price as number });
        } else if (body.action === 'buy' || body.action === 'cancel') {
            listing = await actOnExchangeListing(player, String(body.listingId ?? ''), body.action, body.expectedPrice as number | undefined);
        } else if (body.action !== 'browse') return res.status(400).json({ error: 'Unknown Exchange action.' });
        return res.status(200).json({ ok: true, listing, ...await exchangeSnapshot(player), feePercent: EXCHANGE_FEE_PERCENT, listingLimit: EXCHANGE_LISTING_LIMIT });
    } catch (error) {
        if (error instanceof ExchangeError) return res.status(error.status).json({ error: error.message, pending: error.pending });
        console.error('[sunscar-exchange]', safeLogValue(error));
        return res.status(503).json({ error: 'Your trade is unconfirmed. Refresh the Exchange to recover it safely.', pending: true });
    }
}
