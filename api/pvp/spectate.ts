import type { VercelRequest, VercelResponse } from '@vercel/node';
import { kv } from '../_storage.js';
import { cors } from '../_utils.js';


type Spectator = {
    name: string;
    joinedAt: number;
};

const KV_TTL_SECONDS = 2 * 60 * 60;   // 2-hour TTL
const STALE_MS = 30 * 1000;           // Remove spectators who haven't pinged in 30s

function specKey(battleId: string): string {
    return `pvp:spectators:${battleId}`;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res);
    if (req.method === 'OPTIONS') return res.status(200).end();

    const battleId = typeof req.query.id === 'string' ? req.query.id.trim() : '';
    if (!battleId) return res.status(400).json({ error: 'Missing battle id.' });

    const key = specKey(battleId);

    if (req.method === 'GET') {
        const spectators = await kv.get<Spectator[]>(key) ?? [];
        // Filter stale spectators (haven't pinged in 30s)
        const active = spectators.filter(s => Date.now() - s.joinedAt < STALE_MS);
        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).json(active);
    }

    if (req.method === 'POST') {
        try {
            const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
            const { name, action } = body as {
                name?: string;
                action?: 'join' | 'leave';
            };
            if (!name || !action) return res.status(400).json({ error: 'Missing name or action.' });

            const existing = await kv.get<Spectator[]>(key) ?? [];
            // Remove stale + the named spectator (for both join and leave)
            const filtered = existing.filter(s =>
                Date.now() - s.joinedAt < STALE_MS && s.name !== name.toLowerCase().trim()
            );

            if (action === 'join') {
                filtered.push({ name: name.toLowerCase().trim(), joinedAt: Date.now() });
            }

            await kv.set(key, filtered, { ex: KV_TTL_SECONDS });
            return res.status(200).json(filtered);
        } catch (err) {
            console.error('[pvp/spectate]', err);
            return res.status(500).json({ error: 'Internal server error.' });
        }
    }

    return res.status(405).end();
}
