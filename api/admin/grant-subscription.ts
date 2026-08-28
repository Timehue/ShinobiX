import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { cors, safeName } from '../_utils.js';
import { isFullAdmin } from '../_auth.js';
import { enforceRateLimit } from '../_ratelimit.js';
import { applyAdminSubscription } from '../_subscription.js';

/*
 * POST /api/admin/grant-subscription   (x-admin-password / x-admin-token)
 *
 * Full-admin only. Comps the "Shinobi Supporter" perks for a player regardless
 * of payment, or revokes them. An activation auto-expires after `days` (default
 * 30) via character.patreon.expiresAt. Writes the server-owned patreon flag
 * under the save lock (the same anti-forge field a client save can never set).
 * Mints NO currency or items — only the perk flag.
 *
 * Body: { playerName: string, active?: boolean (default true), days?: number }
 * → 200 { ok, active, tier, expiresAt } | 404 when the player has no server save
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();
    if (!isFullAdmin(req)) return res.status(403).json({ error: 'Full admin access required.' });
    if (!enforceRateLimit(req, res, 'admin-grant-subscription', 30, 60_000)) return;

    const body = typeof req.body === 'string'
        ? (() => { try { return JSON.parse(req.body); } catch { return {}; } })()
        : (req.body ?? {});
    const playerName = safeName(String(body.playerName ?? ''));
    if (!playerName) return res.status(400).json({ error: 'Missing playerName.' });

    const active = body.active !== false; // default action is to grant
    const days = Math.max(1, Math.min(3650, Math.floor(Number(body.days ?? 30)) || 30));

    try {
        const result = await applyAdminSubscription(playerName, active ? { active: true, days } : { active: false });
        if (!result) return res.status(404).json({ error: 'No server save found for that player.' });
        return res.status(200).json({ ok: true, ...result });
    } catch (err) {
        console.error('[admin/grant-subscription]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
