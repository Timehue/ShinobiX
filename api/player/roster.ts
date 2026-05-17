import type { VercelRequest, VercelResponse } from '@vercel/node';
import { kv } from '@vercel/kv';
import { cors } from '../_utils.js';

const REGISTRY_KEY = 'player:registry';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET') return res.status(405).end();

    try {
        const presenceKeys = await kv.keys('presence:*');
        const onlineNames = new Set(presenceKeys.map(k => k.replace('presence:', '').toLowerCase()));

        // Primary: persistent registry (every player who ever connected)
        const rawRegistry = await kv.hgetall<Record<string, string>>(REGISTRY_KEY) ?? {};
        const players: { name: string; level: number; village: string; specialty: string; online: boolean }[] = [];

        for (const [, value] of Object.entries(rawRegistry)) {
            try {
                const entry = typeof value === 'string' ? JSON.parse(value) : value;
                players.push({
                    name: entry.name ?? '',
                    level: entry.level ?? 1,
                    village: entry.village ?? '',
                    specialty: entry.specialty ?? '',
                    online: onlineNames.has((entry.name ?? '').toLowerCase()),
                });
            } catch { /* skip malformed */ }
        }

        // Supplement: scan save:* for any accounts not yet in registry
        const saveKeys = await kv.keys('save:*');
        for (const key of saveKeys) {
            const name = key.replace('save:', '');
            if (players.some(p => p.name.toLowerCase() === name.toLowerCase())) continue;
            players.push({ name, level: 1, village: '', specialty: '', online: onlineNames.has(name.toLowerCase()) });
        }

        players.sort((a, b) => {
            if (a.online !== b.online) return a.online ? -1 : 1;
            return a.name.localeCompare(b.name);
        });

        return res.status(200).json({ players });
    } catch (err) {
        return res.status(500).json({ error: String(err) });
    }
}
