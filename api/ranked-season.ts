import type { VercelRequest, VercelResponse } from './_vercel.js';
import { kv } from './_storage.js';
import { cors } from './_utils.js';
import { SEASON_CURRENT_KEY, SEASON_ARCHIVE_PREFIX, type RankedSeason } from './cron/_ranked-season.js';

/*
 * /api/ranked-season — GET
 *
 * Read-only season info for the Hall of Legends ranked tab: the current season
 * (id + when it ends, for the countdown) and the previous season's archived
 * champions. The live ladder itself comes from player saves as before — this
 * just adds the season clock + last-season standings around it.
 */

type Archive = {
    id: number;
    endedAt: number;
    player: { name: string; village?: string; rating: number; rank: number }[];
    pet: { name: string; village?: string; rating: number; rank: number }[];
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET') return res.status(405).end();

    const current = await kv.get<RankedSeason>(SEASON_CURRENT_KEY);
    // Last season = current.id - 1 (none before season 2).
    const lastId = current && current.id > 1 ? current.id - 1 : 0;
    const lastSeason = lastId ? await kv.get<Archive>(`${SEASON_ARCHIVE_PREFIX}${lastId}`).catch(() => null) : null;

    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=60');
    return res.status(200).json({ current: current ?? null, lastSeason: lastSeason ?? null });
}
