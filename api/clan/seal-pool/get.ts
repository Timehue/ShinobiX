import type { VercelRequest, VercelResponse } from '@vercel/node';
import { cors } from '../../_utils.js';
import { loadPool } from './_storage.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET') return res.status(405).end();

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
