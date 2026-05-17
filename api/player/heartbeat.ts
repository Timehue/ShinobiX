import type { VercelRequest, VercelResponse } from '@vercel/node';
import { kv } from '@vercel/kv';
import { cors } from '../_utils.js';

const REGISTRY_KEY = 'player:registry';

type PresenceEntry = {
    name: string;
    sector: number;
    character: unknown;
    lastSeen: number;
    pendingAttacker: unknown | null;
};

type RegistryEntry = {
    name: string;
    level: number;
    village: string;
    specialty: string;
    lastSeen: number;
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();

    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        const { name, sector, character } = body as { name?: string; sector?: number; character?: unknown };
        if (!name) return res.status(400).json({ error: 'Missing name.' });

        const challengeKey = `challenges:${name.toLowerCase().trim()}`;
        const presenceKey = `presence:${name}`;

        // Read presence + pending challenges in parallel
        const [existing, pendingChallenges] = await Promise.all([
            kv.get<PresenceEntry>(presenceKey),
            kv.get<unknown[]>(challengeKey),
        ]);
        const pendingAttacker = existing?.pendingAttacker ?? null;

        const entry: PresenceEntry = {
            name,
            sector: sector ?? existing?.sector ?? 40,
            character: character ?? existing?.character ?? null,
            lastSeen: Date.now(),
            pendingAttacker: null,
        };

        // Upsert into persistent player registry (never expires — survives presence TTL)
        const ch = character as Record<string, unknown> | null;
        const registryEntry: RegistryEntry = {
            name,
            level: (ch?.level as number) ?? 1,
            village: (ch?.village as string) ?? '',
            specialty: (ch?.specialty as string) ?? '',
            lastSeen: Date.now(),
        };
        const registryField: Record<string, string> = { [name.toLowerCase()]: JSON.stringify(registryEntry) };

        // Store presence + clear delivered challenges + update registry in parallel
        await Promise.all([
            kv.set(presenceKey, entry, { ex: 60 }),
            pendingChallenges?.length ? kv.del(challengeKey) : Promise.resolve(),
            kv.hset(REGISTRY_KEY, registryField),
        ]);

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

        return res.status(200).json({
            sectorMates,
            allPlayers,
            pendingAttacker,
            pendingChallenges: pendingChallenges ?? [],
        });
    } catch (err) {
        return res.status(500).json({ error: String(err) });
    }
}
