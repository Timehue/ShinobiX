import type { ApiRequest, ApiResponse } from './_vercel.js';
import { cors } from './_utils.js';
import { enforceRateLimit } from './_ratelimit.js';
import { safeLogValue } from './_safe-log.js';
import { aggressionView, readNpcAggression } from './_npc-village-aggression.js';
import { readNpcVillageScaling, NPC_SCALING_FLOOR } from './_npc-village-scaling.js';
import { readNpcLeaders } from './_npc-village-leaders.js';

/**
 * GET /api/npc-village — Cinderhold's public standing: its base level, how
 * hostile it is toward each player village (0-100 and a band), and its Kage and
 * elder seats (the defected story Kages). Read-only, no player data, safe to
 * cache briefly.
 */
export default async function handler(req: ApiRequest, res: ApiResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET') return res.status(405).end();
    if (!enforceRateLimit(req, res, 'npc-village', 60, 60_000)) return;
    try {
        const [aggression, scaling, leaders] = await Promise.all([readNpcAggression(), readNpcVillageScaling(), readNpcLeaders()]);
        res.setHeader('Cache-Control', 'public, max-age=60');
        return res.status(200).json({
            baseLevel: scaling?.baseLevel ?? NPC_SCALING_FLOOR,
            aggression: aggressionView(aggression),
            // Empty until players defeat their villages' story Kages.
            leaders: leaders.map(({ seat, village, name, joinedAt }) => ({ seat, village, name, joinedAt })),
        });
    } catch (err) {
        console.error('[npc-village]', safeLogValue(err));
        return res.status(503).json({ error: 'Cinderhold is unavailable. Try again.' });
    }
}
