import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { cors } from '../_utils.js';
import { onlineStore } from '../_realtime/online-store.js';
import { buildPublicLeaderboards, isPublicPlayerIndexKey } from './_public-index.js';
import { readPublicPlayerIndex } from './_public-index-store.js';

function parseLimit(value: unknown): number {
    const n = Number(value);
    if (!Number.isFinite(n)) return 25;
    return Math.max(1, Math.min(Math.floor(n), 100));
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET') return res.status(405).end();

    try {
        const limit = parseLimit(req.query.limit);
        const onlineNames = new Set(onlineStore.list().map((entry) => entry.name));
        const { entries, backfilled, staleKeys } = await readPublicPlayerIndex({ backfill: true, logContext: 'leaderboards' });
        const publicEntries = [...entries.entries()]
            .filter(([key, entry]) => isPublicPlayerIndexKey(key) && isPublicPlayerIndexKey(entry.name))
            .map(([, entry]) => entry);
        const boards = buildPublicLeaderboards(publicEntries, onlineNames, limit);

        res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=10');
        return res.status(200).json({
            ok: true,
            generatedAt: Date.now(),
            limit,
            backfilled,
            stale: staleKeys.length,
            boards,
        });
    } catch (err) {
        console.error('[player-leaderboards]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
