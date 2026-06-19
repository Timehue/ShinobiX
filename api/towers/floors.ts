import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { cors } from '../_utils.js';
import { FLOOR_CATALOG } from './_floor-catalog.js';

/*
 * GET /api/towers/floors — the public floor-catalog metadata for the lobby picker.
 *
 * Display-only fields (no sealed rewards / enemy stats). The catalog is the single source
 * of truth; the client renders the picker from this rather than a duplicated mirror.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET') return res.status(405).end();
    res.setHeader('Cache-Control', 's-maxage=300');
    return res.status(200).json({
        floors: FLOOR_CATALOG.map(f => ({
            id: f.id,
            name: f.name,
            biome: f.biome,
            objective: f.objective,
            roundBudget: f.roundBudget,
            isBoss: !!f.boss,
            milestone: f.firstClearReward.milestone ?? null,
            map: { width: f.map.width, height: f.map.height },
        })),
    });
}
