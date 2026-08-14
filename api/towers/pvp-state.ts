import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { cors, safeName } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimit } from '../_ratelimit.js';
import { projectTowerPvpMatchForViewer, TOWER_PVP_ID } from './_pvp-session.js';
import { towerPvpState } from './_pvp-lifecycle.js';
import { LockContendedError } from '../_lock.js';

/** GET reconnect/poll for a member-owned Tower MPvP match. */
export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET') return res.status(405).end();
    try {
        const playerName = safeName(String(req.query.playerName ?? ''));
        const matchId = String(req.query.matchId ?? '');
        if (!playerName || !TOWER_PVP_ID.test(matchId)) return res.status(400).json({ error: 'Valid player and match are required.' });
        if (!enforceRateLimit(req, res, 'tower-pvp-state', 180, 60_000, playerName)) return;
        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) return res.status(403).json({ error: 'Can only view your own match.' });
        const result = await towerPvpState(matchId, identity.admin ? playerName : identity.name);
        res.setHeader('Cache-Control', 'private, no-store');
        return result.ok
            ? res.status(200).json({ match: projectTowerPvpMatchForViewer(result.match, identity.admin ? playerName : identity.name) })
            : res.status(result.status).json({ error: result.error, errorCode: result.code, match: result.match ? projectTowerPvpMatchForViewer(result.match, identity.admin ? playerName : identity.name) : undefined });
    } catch (error) {
        if (error instanceof LockContendedError) {
            res.setHeader('Retry-After', '1');
            return res.status(503).json({ error: 'Tower MPvP state is busy. Retry this request.', errorCode: 'tower-pvp-busy' });
        }
        console.error('[towers/pvp-state]', error);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
