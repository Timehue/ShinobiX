import type { VercelRequest, VercelResponse } from '@vercel/node';
import { kv } from '../_storage.js';
import { cors } from '../_utils.js';

const REGISTRY_KEY = 'player:registry';
// Single hash that holds every player's presence data as JSON-encoded fields.
// One kv.hgetall() replaces kv.keys('presence:*') + N*kv.get() on every heartbeat.
const PRESENCE_HASH_KEY = 'presence:all';
// Entries older than this are considered offline (matches the individual key TTL of 60s).
const PRESENCE_TTL_MS = 65_000;

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

function normalizeSector(value: unknown, fallback = 40) {
    const sector = Number(value);
    if (!Number.isFinite(sector)) return fallback;
    return Math.max(0, Math.floor(sector));
}

function parsePresenceField(v: unknown): PresenceEntry | null {
    try {
        const parsed: PresenceEntry = typeof v === 'string' ? JSON.parse(v) : v as PresenceEntry;
        if (!parsed?.name) return null;
        return parsed;
    } catch {
        return null;
    }
}

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
        const resetSignalKey = `reset-signal:${name.toLowerCase().trim()}`;

        // Read this player's own presence (for pendingAttacker), challenges, and reset signal in parallel.
        // Individual presence key is still kept so attack.ts / clear-attack.ts can target specific players.
        const [existing, pendingChallenges, resetSignal] = await Promise.all([
            kv.get<PresenceEntry>(presenceKey),
            kv.get<unknown[]>(challengeKey),
            kv.get(resetSignalKey),
        ]);

        if (resetSignal) {
            return res.status(200).json({ forceReload: true });
        }

        const pendingAttacker = existing?.pendingAttacker ?? null;

        const entrySector = normalizeSector(sector, normalizeSector(existing?.sector, 40));
        const entry: PresenceEntry = {
            name,
            sector: entrySector,
            character: character ?? existing?.character ?? null,
            lastSeen: Date.now(),
            pendingAttacker: null,
        };

        const ch = character as Record<string, unknown> | null;
        const registryEntry: RegistryEntry = {
            name,
            level: (ch?.level as number) ?? 1,
            village: (ch?.village as string) ?? '',
            specialty: (ch?.specialty as string) ?? '',
            lastSeen: Date.now(),
        };
        const registryField: Record<string, string> = { [name.toLowerCase()]: JSON.stringify(registryEntry) };
        const entryJson = JSON.stringify(entry);

        // Write individual key (for attack.ts / clear-attack.ts) + hash (for bulk reads) + registry in parallel.
        await Promise.all([
            kv.set(presenceKey, entry, { ex: 60 }),
            kv.hset(PRESENCE_HASH_KEY, { [name]: entryJson }),
            pendingChallenges?.length ? kv.del(challengeKey) : Promise.resolve(),
            kv.hset(REGISTRY_KEY, registryField),
        ]);

        // Single command to get all active presence — replaces kv.keys('presence:*') + N*kv.get().
        const allRaw = await kv.hgetall<Record<string, unknown>>(PRESENCE_HASH_KEY) ?? {};
        const now = Date.now();
        const allEntries: PresenceEntry[] = [];
        const staleNames: string[] = [];

        for (const [field, v] of Object.entries(allRaw)) {
            const p = parsePresenceField(v);
            if (!p) { staleNames.push(field); continue; }
            if (now - p.lastSeen > PRESENCE_TTL_MS) {
                staleNames.push(field);
            } else if (p.name !== name) {
                allEntries.push(p);
            }
        }

        // Lazily prune stale entries from the hash (fire-and-forget — don't block the response).
        if (staleNames.length > 0) {
            void kv.hdel(PRESENCE_HASH_KEY, ...staleNames);
        }

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

        const sectorMates = allEntries
            .filter(p => normalizeSector(p.sector) === entry.sector)
            .map(toRecord);

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
