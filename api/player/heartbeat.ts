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

        // Store with 60s TTL — auto-expires when player goes offline (heartbeat every 20s)
        await kv.set(key, entry, { ex: 60 });

        // Fetch all active presence entries
        const allKeys = await kv.keys('presence:*');
        const allEntries = (await Promise.all(allKeys.map(k => kv.get<PresenceEntry>(k))))
            .filter((p): p is PresenceEntry => !!p && p.name !== name);

        const toRecord = ({ name: n, sector: s, character: c }: PresenceEntry) => {
            const ch = c as Record<string, unknown> | null;
            return {
                name: n, sector: s, character: c,
                level: ch?.level ?? 1,
                village: ch?.village ?? '',
                specialty: ch?.specialty ?? 'Ninjutsu',
                currentSector: s,
                lastSeenAt: Date.now(),
            };
        };

        // sectorMates — same sector only (for world-map display)
        const sectorMates = allEntries
            .filter(p => p.sector === entry.sector)
            .map(toRecord);

        // allPlayers — every active player (for roster, search, pet arena, spar, etc.)
        const allPlayers = allEntries.map(toRecord);

        return res.status(200).json({ sectorMates, allPlayers, pendingAttacker });
    } catch (err) {
        return res.status(500).json({ error: String(err) });
    }
}
