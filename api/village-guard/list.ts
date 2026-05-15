import type { VercelRequest, VercelResponse } from '@vercel/node';
import { kv } from '@vercel/kv';
import { cors } from '../_utils.js';

type GuardEntry = { name: string; village: string; level: number; lastSeen: number };

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();

    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        const { village } = body as { village?: string };
        if (!village) return res.status(400).json({ error: 'Missing village.' });

        const keys = await kv.keys('guard:*');
        const guards = (await Promise.all(keys.map(k => kv.get<GuardEntry>(k))))
            .filter((g): g is GuardEntry => !!g && g.village === village)
            .map(({ name, level, village: v }) => ({ name, level, village: v }));

        return res.status(200).json(guards);
    } catch (err) {
        return res.status(500).json({ error: String(err) });
    }
}
