import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { cors } from '../_utils.js';

/** Retired compatibility route. Locked doors are run-state events now; keeping
 * this explicit tombstone prevents older/direct callers from rolling pets or
 * loot outside the exact ledger while deployments converge. */
export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    return res.status(410).json({ error: 'Use the server-owned Hollow Gate event route.' });
}
