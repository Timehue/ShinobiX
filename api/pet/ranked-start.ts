import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { cors } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { PET_RANKED_DISABLED_REASON, petRankedStartsEnabled } from './_ranked-settlement.js';

/*
 * /api/pet/ranked-start — POST only
 *
 * Ranked pet combat is client-resolved today, so this endpoint MUST NOT mint a
 * token that can move the competitive ladder. Sealing only the participants and
 * pre-match ratings does not prove who won; the first reporter can choose the
 * outcome. Starts remain server-disabled until a deterministic server combat
 * engine writes a `server-engine-v1` resolution into the private match token.
 */

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();

    const identity = await authedPlayerOrAdmin(req);
    if (!identity) return res.status(401).json({ error: 'Authentication required.' });
    if (identity.admin) {
        return res.status(400).json({ error: 'Ranked pet matches require a player identity.' });
    }

    if (!(await enforceRateLimitKv(req, res, 'pet-ranked-start', 12, 60_000, identity.name))) return;

    if (!petRankedStartsEnabled()) {
        return res.status(503).json({
            ok: false,
            error: PET_RANKED_DISABLED_REASON,
            reason: 'Ranked pet matches require a deterministic server-resolved outcome.',
        });
    }

    // Unreachable until petRankedStartsEnabled is intentionally changed as part
    // of the server-engine integration. Keeping the denial here makes a future
    // partial flag/config rollout fail closed as well.
    return res.status(503).json({ ok: false, error: PET_RANKED_DISABLED_REASON });
}
