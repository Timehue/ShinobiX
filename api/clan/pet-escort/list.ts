import type { VercelRequest, VercelResponse } from '@vercel/node';
import { cors } from '../../_utils.js';
import { listActiveEscorters } from './_storage.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET') return res.status(405).end();

    try {
        const clanName = String(req.query.clanName ?? '').trim();
        if (!clanName) return res.status(400).json({ error: 'Missing clanName.' });
        const escorters = await listActiveEscorters(clanName);
        return res.status(200).json({ clanName, escorters });
    } catch (err) {
        console.error('[clan/pet-escort/list]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
