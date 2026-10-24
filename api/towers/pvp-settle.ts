import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { cors, safeName } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimit } from '../_ratelimit.js';
import { projectTowerPvpMatchForViewer, TOWER_PVP_ID } from './_pvp-session.js';
import { settleTowerPvpMatch } from './_pvp-lifecycle.js';
import { settleTowerPvpPurse, towerPvpPurseReply } from './_pvp-purse.js';
import { LockContendedError } from '../_lock.js';
import { PvpCreditSlotPendingError } from '../pvp/_valid-fight.js';

/** POST an idempotent terminal acknowledgement, then the winner's Team Arena purse. */
export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();
    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
        const playerName = safeName(String(body.playerName ?? ''));
        const matchId = String(body.matchId ?? '');
        if (!playerName || !TOWER_PVP_ID.test(matchId)) return res.status(400).json({ error: 'Valid player and match are required.' });
        if (!enforceRateLimit(req, res, 'tower-pvp-settle-preauth', (30) * 20, 60_000)) return;
        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) return res.status(403).json({ error: 'Can only settle your own match.' });
        if (!enforceRateLimit(req, res, 'tower-pvp-settle', 30, 60_000, identity.admin ? playerName : identity.name)) return;
        const slug = identity.admin ? playerName : identity.name;
        const result = await settleTowerPvpMatch(matchId, slug, {}, 'public-queue');
        res.setHeader('Cache-Control', 'private, no-store');
        if (!result.ok) {
            return res.status(result.status).json({ error: result.error, errorCode: result.code, match: result.match ? projectTowerPvpMatchForViewer(result.match, slug) : undefined });
        }
        // The acknowledgement writes no save; the Team Arena purse (owner
        // amendment A7) is its own receipted credit, retried by any re-settle.
        const purse = await settleTowerPvpPurse(result.response.match, slug);
        return res.status(200).json({
            ...result.response,
            match: projectTowerPvpMatchForViewer(result.response.match, slug),
            ...towerPvpPurseReply(purse),
        });
    } catch (error) {
        // An unconfirmed purse pair slot leaves the purse unpaid; a repeat settle retries it.
        if (error instanceof LockContendedError || error instanceof PvpCreditSlotPendingError) {
            res.setHeader('Retry-After', '1');
            return res.status(503).json({ error: 'Tower MPvP state is busy. Retry this request.', errorCode: 'tower-pvp-busy' });
        }
        console.error('[towers/pvp-settle]', error);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
