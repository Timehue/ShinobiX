import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { cors } from '../_utils.js';
import { sectorObstaclesEnabled } from '../_release-flags.js';

/** Public presentation metadata. No saves, rewards, or account data. */
export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed.' });
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ obstaclesEnabled: sectorObstaclesEnabled() });
}
