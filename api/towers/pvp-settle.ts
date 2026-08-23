import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { cors, safeName } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimit } from '../_ratelimit.js';
import { projectTowerPvpMatchForViewer, TOWER_PVP_ID } from './_pvp-session.js';
import { settleTowerPvpMatch } from './_pvp-lifecycle.js';
import { LockContendedError } from '../_lock.js';

/** POST an idempotent zero-reward terminal acknowledgement. */
export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();
    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
        const playerName = safeName(String(body.playerName ?? ''));
        const matchId = String(body.matchId ?? '');
        if (!playerName || !TOWER_PVP_ID.test(matchId)) return res.status(400).json({ error: 'Valid player and match are required.' });
        if (!enforceRateLimit(req, res, 'tower-pvp-settle', 30, 60_000, playerName)) return;
        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) return res.status(403).json({ error: 'Can only settle your own match.' });
        const slug = identity.admin ? playerName : identity.name;
        const result = await settleTowerPvpMatch(matchId, slug, {}, 'public-queue');
        res.setHeader('Cache-Control', 'private, no-store');
        return result.ok
            ? res.status(200).json({ ...result.response, match: projectTowerPvpMatchForViewer(result.response.match, slug) })
            : res.status(result.status).json({ error: result.error, errorCode: result.code, match: result.match ? projectTowerPvpMatchForViewer(result.match, slug) : undefined });
    } catch (error) {
        if (error instanceof LockContendedError) {
            res.setHeader('Retry-After', '1');
            return res.status(503).json({ error: 'Tower MPvP state is busy. Retry this request.', errorCode: 'tower-pvp-busy' });
        }
        console.error('[towers/pvp-settle]', error);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
