import { safeLogValue } from '../_safe-log.js';
import type { ApiRequest, ApiResponse } from '../_vercel.js';
import { cors } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { onlineStore } from '../_realtime/online-store.js';
import { isCoastSector } from '../../shared/world-maps.js';
import { coastPatrolViews } from './_patrols.js';

/*
 * POST /api/coast/patrols
 *
 * Who walks the coast sector the player is standing in today (see
 * _patrols.ts), and which of them this player has already driven off.
 *
 * The sector is the server's own record of where the player is, never a value
 * from the request, so the roster of a sector cannot be read from afar. A
 * patrol is fought through /api/missions/ai-fight-start like any world fight.
 */
export default async function handler(req: ApiRequest, res: ApiResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();
    try {
        const identity = await authedPlayerOrAdmin(req);
        if (!identity || identity.admin) return res.status(401).json({ error: 'Player authentication required.' });
        if (!(await enforceRateLimitKv(req, res, 'coast-patrols', 30, 60_000, identity.name))) return;
        const presence = onlineStore.get(identity.name);
        if (!presence || presence.locationUnverified) return res.status(409).json({ error: 'Step out into the world first.' });
        if (!isCoastSector(presence.sector)) return res.status(409).json({ error: 'You are not on the coast.' });
        return res.status(200).json({ ok: true, sector: presence.sector, patrols: await coastPatrolViews(identity.name, presence.sector, Date.now()) });
    } catch (err) {
        console.error('[coast/patrols]', safeLogValue(err));
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
