import type { VercelRequest, VercelResponse } from '../../_vercel.js';
import { cors } from '../../_utils.js';
import { authedPlayerOrAdmin } from '../../_auth.js';
import { loadPool } from './_storage.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET') return res.status(405).end();

    // Auth gate: previously anon-readable. The pool balance + recent
    // donation log (donor names + amounts + timestamps) is useful intel
    // for griefing campaigns. Any logged-in player can read; we don't
    // restrict to clan members because the in-game UI shows other clans'
    // pools in the Clan Hall comparison view.
    const identity = await authedPlayerOrAdmin(req);
    if (!identity) return res.status(401).json({ error: 'Authentication required.' });

    try {
        const clanName = String(req.query.clanName ?? '').trim();
        if (!clanName) return res.status(400).json({ error: 'Missing clanName.' });
        const pool = await loadPool(clanName);
        return res.status(200).json({
            clanName: pool.clanName,
            balance: pool.balance,
            log: pool.log.slice(0, 20),
        });
    } catch (err) {
        console.error('[clan/seal-pool/get]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
