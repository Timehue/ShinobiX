import type { VercelRequest, VercelResponse } from '@vercel/node';
import { kv } from '../_storage.js';
import { cors } from '../_utils.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET') return res.status(405).end();

    try {
        // Clans are stored with key pattern clan:{id}
        const keys = await kv.keys('clan:*');
        if (!keys.length) return res.status(200).json([]);
        const clans = await Promise.all(keys.map(k => kv.get(k)));
        return res.status(200).json(clans.filter(Boolean));
    } catch (err) {
        return res.status(500).json({ error: String(err) });
    }
}
