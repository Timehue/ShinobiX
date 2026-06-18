import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { kv } from '../_storage.js';
import { cors } from '../_utils.js';
import { isAdmin } from '../_auth.js';
import { enforceRateLimit } from '../_ratelimit.js';
import { recordAudit } from '../_audit.js';
import { startRankedSeason, forceRankedSeasonRollover, SEASON_CURRENT_KEY, type RankedSeason } from '../cron/_ranked-season.js';

/*
 * /api/admin/ranked-season — admin control for ranked seasons.
 *
 *   GET                         → { active, current }    (status for the panel)
 *   POST { action: 'start' }    → start season 1 (no-op if already active)
 *   POST { action: 'rollover' } → force-end the current season NOW (reward +
 *                                 archive + soft reset) and begin the next
 *
 * Ranked seasons do NOT auto-start; an admin kicks them off here. Admin-gated
 * via the x-admin-password header (same as the other admin endpoints).
 */

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();

    if (req.method === 'GET') {
        if (!isAdmin(req)) return res.status(401).json({ error: 'Unauthorized.' });
        const current = await kv.get<RankedSeason>(SEASON_CURRENT_KEY);
        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).json({ active: !!current, current: current ?? null });
    }

    if (req.method !== 'POST') return res.status(405).end();
    if (!enforceRateLimit(req, res, 'admin-ranked-season', 30, 5 * 60_000)) return;
    if (!isAdmin(req)) return res.status(401).json({ error: 'Unauthorized.' });

    try {
        const body = (typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {})) as Record<string, unknown>;
        const action = typeof body.action === 'string' ? body.action : '';

        if (action === 'start') {
            const result = await startRankedSeason();
            await recordAudit({ domain: 'reward', actor: 'admin', action: 'ranked-season.start', meta: { result } }).catch(() => undefined);
            return res.status(200).json(result);
        }
        if (action === 'rollover') {
            const result = await forceRankedSeasonRollover();
            await recordAudit({ domain: 'reward', actor: 'admin', action: 'ranked-season.rollover', meta: { result } }).catch(() => undefined);
            return res.status(200).json(result);
        }
        return res.status(400).json({ error: "Unknown action. Use 'start' or 'rollover'." });
    } catch (err) {
        console.error('[admin/ranked-season]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
