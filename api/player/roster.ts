import type { VercelRequest, VercelResponse } from '@vercel/node';
import { kv } from '@vercel/kv';
import { cors } from '../_utils.js';

const REGISTRY_KEY = 'player:registry';

type RosterPlayer = {
    name: string;
    level: number;
    village: string;
    specialty: string;
    online: boolean;
    character?: unknown;
    currentSector?: number;
    lastSeenAt?: number;
};

type PresenceEntry = {
    name: string;
    sector: number;
    character?: unknown;
    lastSeen?: number;
};

function normalizeSector(value: unknown, fallback = 40) {
    const sector = Number(value);
    if (!Number.isFinite(sector)) return fallback;
    return Math.max(0, Math.floor(sector));
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET') return res.status(405).end();

    try {
        const presenceKeys = await kv.keys('presence:*');
        const presenceEntries = (await Promise.all(presenceKeys.map(k => kv.get<PresenceEntry>(k))))
            .filter((entry): entry is PresenceEntry => Boolean(entry?.name));
        const livePresenceByName = new Map(presenceEntries.map(entry => [entry.name.toLowerCase(), entry]));
        const onlineNames = new Set(livePresenceByName.keys());

        // Primary: persistent registry (every player who ever connected)
        const rawRegistry = await kv.hgetall<Record<string, string>>(REGISTRY_KEY) ?? {};
        const players: RosterPlayer[] = [];

        for (const [key, value] of Object.entries(rawRegistry)) {
            try {
                const entry = typeof value === 'string' ? JSON.parse(value) : value;
                const save = await kv.get<Record<string, unknown>>(`save:${key}`);
                const livePresence = livePresenceByName.get((entry.name ?? '').toLowerCase());
                const character = livePresence?.character ?? save?.character;
                players.push({
                    name: entry.name ?? '',
                    level: entry.level ?? 1,
                    village: entry.village ?? '',
                    specialty: entry.specialty ?? '',
                    online: onlineNames.has((entry.name ?? '').toLowerCase()),
                    character,
                    currentSector: normalizeSector(livePresence?.sector, normalizeSector(save?.currentSector, 40)),
                    lastSeenAt: livePresence?.lastSeen ?? entry.lastSeen ?? 0,
                });
            } catch { /* skip malformed */ }
        }

        // Supplement: scan save:* for any accounts not yet in registry
        const saveKeys = await kv.keys('save:*');
        for (const key of saveKeys) {
            const name = key.replace('save:', '');
            if (players.some(p => p.name.toLowerCase() === name.toLowerCase())) continue;
            try {
                const save = await kv.get<Record<string, unknown>>(key);
                const livePresence = livePresenceByName.get(name.toLowerCase());
                const character = (livePresence?.character ?? save?.character) as Record<string, unknown> | undefined;
                if (!character) continue;
                players.push({
                    name: (character.name as string) ?? name,
                    level: (character.level as number) ?? 1,
                    village: (character.village as string) ?? '',
                    specialty: (character.specialty as string) ?? '',
                    online: onlineNames.has(name.toLowerCase()),
                    character,
                    currentSector: normalizeSector(livePresence?.sector, normalizeSector(save?.currentSector, 40)),
                    lastSeenAt: livePresence?.lastSeen ?? 0,
                });
            } catch {
                // skip unreadable saves
            }
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
