import type { VercelRequest, VercelResponse } from '@vercel/node';
import { kv } from '../_storage.js';
import { cors } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';

type GuardEntry = { name: string; village: string; level: number; lastSeen: number };

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();

    // Read-style endpoint but POST — require login at minimum so anonymous bots
    // can't enumerate the guard roster.
    const identity = await authedPlayerOrAdmin(req);
    if (!identity) return res.status(401).json({ error: 'Authentication required.' });

    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        const { village } = body as { village?: string };
        if (!village) return res.status(400).json({ error: 'Missing village.' });

        const keys = await kv.keys('guard:*');
        const guards = (await kv.mget<GuardEntry[]>(...keys))
            .filter((g): g is GuardEntry => !!g && g.village === village)
            .map(({ name, level, village: v }) => ({ name, level, village: v }));

        return res.status(200).json(guards);
    } catch (err) {
        console.error('[village-guard/list]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
