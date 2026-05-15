import type { VercelRequest, VercelResponse } from '@vercel/node';
import { kv } from '@vercel/kv';
import { safeName, mergePreservingImages, cors } from '../_utils.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res);
    if (req.method === 'OPTIONS') return res.status(200).end();

    const name = safeName(String(req.query.name ?? ''));
    if (!name) return res.status(400).json({ error: 'Invalid name.' });

    const key = `save:${name}`;

    if (req.method === 'GET') {
        const data = await kv.get(key);
        if (data === null) return res.status(404).end();
        return res.status(200).json(data);
    }

    if (req.method === 'POST') {
        try {
            const incoming = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
            const existing = await kv.get(key);
            const payload = existing ? mergePreservingImages(incoming, existing) : incoming;
            await kv.set(key, payload);
            return res.status(200).end();
        } catch (err) {
            return res.status(500).json({ error: String(err) });
        }
    }

    return res.status(405).end();
}
