import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { kv } from '../_storage.js';
import { cors } from '../_utils.js';
import { isFullAdmin } from '../_auth.js';
import { enforceRateLimit } from '../_ratelimit.js';
import { recordAudit } from '../_audit.js';
import { startRankedSeason, stopRankedSeason, forceRankedSeasonRollover, SEASON_CURRENT_KEY, rankedSeasonAdmissionsPaused, type RankedSeason } from '../cron/_ranked-season.js';
import { readPetRankedSeasonGateFresh } from '../pet/_ranked-preparation.js';

/*
 * /api/admin/ranked-season — admin control for ranked seasons.
 *
 *   GET                         → { active, acceptingEntries, current }
 *   POST { action: 'start' }    → start season 1 or resume a stopped season
 *   POST { action: 'stop' }     → pause new entries without touching standings
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
        if (!isFullAdmin(req)) return res.status(401).json({ error: 'Full admin access required.' });
        const [current, gate] = await Promise.all([
            kv.get<RankedSeason>(SEASON_CURRENT_KEY),
            readPetRankedSeasonGateFresh(kv),
        ]);
        const acceptingEntries = !!current
            && gate?.state === 'open'
            && gate.seasonId === current.id
            && !(await rankedSeasonAdmissionsPaused(kv, current.id));
        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).json({ active: !!current, acceptingEntries, current: current ?? null });
    }

    if (req.method !== 'POST') return res.status(405).end();
    if (!enforceRateLimit(req, res, 'admin-ranked-season', 30, 5 * 60_000)) return;
    if (!isFullAdmin(req)) return res.status(401).json({ error: 'Full admin access required.' });

    try {
        const body = (typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {})) as Record<string, unknown>;
        const action = typeof body.action === 'string' ? body.action : '';

        if (action === 'start') {
            const result = await startRankedSeason();
            await recordAudit({ domain: 'reward', actor: 'admin', action: 'ranked-season.start', meta: { result } }).catch(() => undefined);
            return res.status(200).json(result);
        }
        if (action === 'stop') {
            const result = await stopRankedSeason();
            await recordAudit({ domain: 'reward', actor: 'admin', action: 'ranked-season.stop', meta: { result } }).catch(() => undefined);
            return res.status(200).json(result);
        }
        if (action === 'rollover') {
            const result = await forceRankedSeasonRollover();
            await recordAudit({ domain: 'reward', actor: 'admin', action: 'ranked-season.rollover', meta: { result } }).catch(() => undefined);
            return res.status(200).json(result);
        }
        return res.status(400).json({ error: "Unknown action. Use 'start', 'stop', or 'rollover'." });
    } catch (err) {
        console.error('[admin/ranked-season]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
