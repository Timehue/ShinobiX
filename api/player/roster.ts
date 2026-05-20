import type { VercelRequest, VercelResponse } from '@vercel/node';
import { kv } from '@vercel/kv';
import { cors } from '../_utils.js';

const REGISTRY_KEY = 'player:registry';
const PRESENCE_HASH_KEY = 'presence:all';
const PRESENCE_TTL_MS = 65_000;

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
        // One command instead of kv.keys('presence:*') + N*kv.get().
        const allPresenceRaw = await kv.hgetall<Record<string, unknown>>(PRESENCE_HASH_KEY) ?? {};
        const now = Date.now();
        const presenceEntries: PresenceEntry[] = [];
        for (const v of Object.values(allPresenceRaw)) {
            try {
                const p: PresenceEntry = typeof v === 'string' ? JSON.parse(v) : v as PresenceEntry;
                if (p?.name && now - (p.lastSeen ?? 0) <= PRESENCE_TTL_MS) presenceEntries.push(p);
            } catch { /* skip malformed */ }
        }
        const livePresenceByName = new Map(presenceEntries.map(entry => [entry.name.toLowerCase(), entry]));
        const onlineNames = new Set(livePresenceByName.keys());

        // Primary: persistent registry (every player who ever connected)
        const rawRegistry = await kv.hgetall<Record<string, string>>(REGISTRY_KEY) ?? {};
        const registryKeys = Object.keys(rawRegistry);

        // Batch-fetch all saves in one command instead of N sequential kv.get() calls.
        const saveKeys = registryKeys.map(k => `save:${k}`);
        const saves = saveKeys.length > 0
            ? await kv.mget<Record<string, unknown>[]>(...saveKeys)
            : [];

        const players: RosterPlayer[] = [];

        for (let i = 0; i < registryKeys.length; i++) {
            const key = registryKeys[i]!;
            const value = rawRegistry[key]!;
            try {
                const entry = typeof value === 'string' ? JSON.parse(value) : value;
                const save = saves[i] ?? null;
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

        // Supplement: any saves not yet in the registry — no extra get() calls needed,
        // just list their names so they show up; character data will arrive on next heartbeat.
        const saveKeysFull = await kv.keys('save:*');
        for (const key of saveKeysFull) {
            const name = key.replace('save:', '');
            if (players.some(p => p.name.toLowerCase() === name.toLowerCase())) continue;
            const livePresence = livePresenceByName.get(name.toLowerCase());
            // Only include if they have live presence (character data available without a save read).
            if (!livePresence?.character) continue;
            const character = livePresence.character as Record<string, unknown>;
            players.push({
                name: (character.name as string) ?? name,
                level: (character.level as number) ?? 1,
                village: (character.village as string) ?? '',
                specialty: (character.specialty as string) ?? '',
                online: true,
                character,
                currentSector: normalizeSector(livePresence.sector, 40),
                lastSeenAt: livePresence.lastSeen ?? 0,
            });
        }

        players.sort((a, b) => {
            if (a.online !== b.online) return a.online ? -1 : 1;
            return a.name.localeCompare(b.name);
        });

        // 60s CDN cache — the client only polls every 5 min anyway, and online status
        // is supplemented by the heartbeat, so 60s staleness here is invisible.
        res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=10');
        return res.status(200).json({ players });
    } catch (err) {
        return res.status(500).json({ error: String(err) });
    }
}
