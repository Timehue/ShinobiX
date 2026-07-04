import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { cors } from '../_utils.js';
import { kv } from '../_storage.js';
import { weekKey } from '../missions/_weekly-board.js';
import { spireLbKey, type SpireBoardEntry } from './_tower-store.js';

/*
 * GET /api/towers/spire-leaderboard[?top=N]  →  { weekKey, total, leaderboard }
 *
 * Public, read-only weekly Endless Spire board. Reads the MAINTAINED board (upserted by
 * settleSpireForMember on every clear — best tier per player this reset-week), so this is a
 * single KV read, never a save scan. Only the display-safe projection is returned
 * (name / tier / village / level — the same public surface the roster already exposes).
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed.' });

    try {
        const wk = weekKey(Date.now());
        const topRaw = Number(req.query.top);
        const limit = Number.isInteger(topRaw) && topRaw > 0 && topRaw <= 100 ? topRaw : 25;
        const list = (await kv.get<SpireBoardEntry[]>(spireLbKey(wk))) ?? [];
        const arr = Array.isArray(list) ? list : [];
        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).json({
            weekKey: wk,
            total: arr.length,
            leaderboard: arr.slice(0, limit).map((e, i) => ({
                rank: i + 1, name: e.name, tier: e.tier, village: e.village, level: e.level,
            })),
        });
    } catch (err) {
        console.error('[towers/spire-leaderboard]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
