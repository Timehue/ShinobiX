import type { VercelRequest, VercelResponse } from '@vercel/node';
import { kv } from '@vercel/kv';
import { cors } from '../_utils.js';

type PresenceEntry = {
    name: string;
    sector: number;
    character: unknown;
    lastSeen: number;
    pendingAttacker: unknown | null;
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();

    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        const { name, sector, character } = body as { name?: string; sector?: number; character?: unknown };
        if (!name) return res.status(400).json({ error: 'Missing name.' });

        const key = `presence:${name}`;
        const existing = await kv.get<PresenceEntry>(key);
        const pendingAttacker = existing?.pendingAttacker ?? null;

        const entry: PresenceEntry = {
            name,
            sector: sector ?? existing?.sector ?? 40,
            character: character ?? existing?.character ?? null,
            lastSeen: Date.now(),
            pendingAttacker: null,
        };

        // Store with 30s TTL — auto-expires when player goes offline
        await kv.set(key, entry, { ex: 30 });

        // Find all players in same sector
        const allKeys = await kv.keys('presence:*');
        const others = (await Promise.all(allKeys.map(k => kv.get<PresenceEntry>(k))))
            .filter((p): p is PresenceEntry => !!p && p.name !== name && p.sector === entry.sector)
            .map(({ name: n, sector: s, character: c }) => {
                const ch = c as Record<string, unknown> | null;
                return {
                    name: n, sector: s, character: c,
                    level: ch?.level ?? 1,
                    village: ch?.village ?? '',
                    specialty: ch?.specialty ?? 'Ninjutsu',
                };
            });

        return res.status(200).json({ sectorMates: others, pendingAttacker });
    } catch (err) {
        return res.status(500).json({ error: String(err) });
    }
}
