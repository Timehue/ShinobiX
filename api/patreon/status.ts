import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { cors, safeName } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimit } from '../_ratelimit.js';
import {
    patreonConfigured,
    getLinkedPatreonUserId,
    getMemberRecord,
    subMinCents,
} from './_patreon.js';

/*
 * GET /api/patreon/status?playerName=<name>
 *
 * Player-authenticated read of the caller's Patreon link + subscription state,
 * for the in-app "Link Patreon" button / subscriber badge. The AUTHORITATIVE
 * flag the perk gates read is character.patreon on the save; this endpoint
 * mirrors the reconciled member ledger for display and is kept in lockstep by
 * the webhook + OAuth callback.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET') return res.status(405).end();
    if (!enforceRateLimit(req, res, 'patreon-status', 60, 60_000)) return;

    const playerName = safeName(String(req.query?.playerName ?? ''));
    if (!playerName) return res.status(400).json({ error: 'Missing playerName.' });

    const identity = await authedPlayerOrAdmin(req, playerName);
    if (!identity) return res.status(401).json({ error: 'Authentication required.' });
    if (!identity.admin && identity.name !== playerName) {
        return res.status(403).json({ error: 'You can only read your own status.' });
    }

    const userId = await getLinkedPatreonUserId(playerName);
    const rec = userId ? await getMemberRecord(userId) : null;

    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({
        ok: true,
        configured: patreonConfigured(),
        linked: !!userId,
        active: rec?.active ?? false,
        tier: rec?.tier ?? 'none',
        entitledCents: rec?.entitledCents ?? 0,
        minCents: subMinCents(),
    });
}
