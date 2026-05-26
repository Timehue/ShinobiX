import type { VercelRequest, VercelResponse } from '@vercel/node';
import { cors } from '../../_utils.js';
import { applyLazyClanWarExpiry, loadAllClanWars } from './_storage.js';

// GET /api/clan/war/list
// Returns all clan wars (active + recently ended) so the client can
// render the Shinobi Council Hall "Clan Battles" tab.
//
// Applies lazy stale-challenge / stale-war expiry on read so the
// response always reflects the current logical state — but does NOT
// persist (POST endpoints do that). Concurrent readers stay
// consistent because POSTs hold the war lock during their writes.

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET') return res.status(405).end();

    try {
        const wars = await loadAllClanWars();
        const now = Date.now();
        const projected = wars.map(w => applyLazyClanWarExpiry(w, now).war);
        // CDN cache 10s so a clan with many clients polling doesn't
        // hammer KV. Stale-while-revalidate=5 keeps it snappy.
        res.setHeader('Cache-Control', 's-maxage=10, stale-while-revalidate=5');
        return res.status(200).json({ wars: projected });
    } catch (err) {
        console.error('[clan/war/list]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
