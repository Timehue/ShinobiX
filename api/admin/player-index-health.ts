import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { isFullAdmin } from '../_auth.js';
import { enforceRateLimit } from '../_ratelimit.js';
import { kv } from '../_storage.js';
import { cors } from '../_utils.js';
import { summarizePublicIndexHealth } from '../player/_public-index.js';
import { readPublicPlayerIndex } from '../player/_public-index-store.js';

function truthy(value: unknown): boolean {
    return value === true || value === '1' || value === 'true' || value === 'yes';
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).end();
    if (!isFullAdmin(req)) return res.status(403).json({ error: 'Full admin access required.' });
    if (!enforceRateLimit(req, res, 'admin-player-index-health', 30, 60_000)) return;

    try {
        const scanSaves = truthy(req.query.scan);
        const [{ rawRegistry, backfilled, staleKeys }, saveKeys] = await Promise.all([
            readPublicPlayerIndex({ backfill: true, logContext: 'admin-player-index-health' }),
            scanSaves ? kv.keys('save:*') : Promise.resolve(undefined),
        ]);
        const health = summarizePublicIndexHealth(rawRegistry, saveKeys, Date.now());

        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).json({
            ok: true,
            backfilled,
            staleBeforeBackfill: staleKeys.length,
            health,
        });
    } catch (err) {
        console.error('[admin-player-index-health]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
