import type { VercelRequest, VercelResponse } from '@vercel/node';
import { kv } from '../_storage.js';
import { cors } from '../_utils.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();

    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        const { name, village, level } = body as { name?: string; village?: string; level?: number };
        if (!name || !village) return res.status(400).json({ error: 'Missing name or village.' });

        await kv.set(`guard:${name}`, { name, village, level: level ?? 1, lastSeen: Date.now() }, { ex: 300 });
        return res.status(200).json({ ok: true });
    } catch (err) {
        return res.status(500).json({ error: String(err) });
    }
}
