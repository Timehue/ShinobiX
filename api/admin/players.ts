import type { VercelRequest, VercelResponse } from '@vercel/node';
import { kv } from '@vercel/kv';
import { cors } from '../_utils.js';

const REGISTRY_KEY = 'player:registry';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();

    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        const { password } = body as { password?: string };

        const adminPassword = process.env.ADMIN_PASSWORD;
        if (!adminPassword || password !== adminPassword) {
            return res.status(401).json({ error: 'Unauthorized.' });
        }

        // Pull presence keys to determine who is online right now
        const presenceKeys = await kv.keys('presence:*');
        const onlineNames = new Set(presenceKeys.map(k => k.replace('presence:', '').toLowerCase()));

        // Primary source: persistent player registry (hset by heartbeat + save API)
        const rawRegistry = await kv.hgetall<Record<string, string>>(REGISTRY_KEY) ?? {};
        const players: { name: string; level: number; village: string; specialty: string; lastSeen: number; online: boolean }[] = [];

        for (const [, value] of Object.entries(rawRegistry)) {
            try {
                const entry = typeof value === 'string' ? JSON.parse(value) : value;
                players.push({
                    name: entry.name ?? '',
                    level: entry.level ?? 1,
                    village: entry.village ?? '',
                    specialty: entry.specialty ?? '',
                    lastSeen: entry.lastSeen ?? 0,
                    online: onlineNames.has((entry.name ?? '').toLowerCase()),
                });
            } catch {
                // skip malformed entry
            }
        }

        // Scan all save:* keys — needed to catch accounts not yet in the registry
        // AND to collect player-submitted bloodlines.
        const saveKeys = await kv.keys('save:*');

        // Collect all bloodlines from all player saves in parallel
        type RawBloodline = Record<string, unknown>;
        type BloodlineEntry = {
            id: string;
            name: string;
            rank: string;
            image?: string;
            specialElement?: string;
            lore?: string;
            jutsus: unknown[];
            totalPoints: number;
            ownerName: string;
            ownerKey: string;
        };
        const bloodlineEntries: BloodlineEntry[] = [];

        const saveSnaps = await Promise.all(
            saveKeys.map(async (key) => {
                try {
                    const snap = await kv.get<Record<string, unknown>>(key);
                    return { key, snap };
                } catch {
                    return { key, snap: null };
                }
            })
        );

        for (const { key, snap } of saveSnaps) {
            const name = key.replace('save:', '');
            const char = snap?.character as Record<string, unknown> | undefined;

            // Add to player list if not already present from registry
            if (!players.some(p => p.name.toLowerCase() === name.toLowerCase())) {
                players.push({
                    name: (char?.name as string) ?? name,
                    level: (char?.level as number) ?? 1,
                    village: (char?.village as string) ?? '',
                    specialty: (char?.specialty as string) ?? '',
                    lastSeen: 0,
                    online: onlineNames.has(name.toLowerCase()),
                });
            }

            // Collect bloodlines
            const rawBloodlines = snap?.savedBloodlines as RawBloodline[] | undefined;
            if (Array.isArray(rawBloodlines)) {
                const ownerName = (char?.name as string) ?? name;
                for (const bl of rawBloodlines) {
                    if (!bl?.id || !bl?.name) continue;
                    bloodlineEntries.push({
                        id: String(bl.id),
                        name: String(bl.name),
                        rank: String(bl.rank ?? 'B Rank'),
                        image: bl.image ? String(bl.image) : undefined,
                        specialElement: bl.specialElement ? String(bl.specialElement) : undefined,
                        lore: bl.lore ? String(bl.lore) : undefined,
                        jutsus: Array.isArray(bl.jutsus) ? bl.jutsus : [],
                        totalPoints: Number(bl.totalPoints ?? 0),
                        ownerName,
                        ownerKey: name,
                    });
                }
            }
        }

        // Restore bloodline images from shared KV image store
        // (saveBloodline strips large data-urls on auto-save; they live in shared:imgfields:bloodline)
        if (bloodlineEntries.length > 0) {
            try {
                const sharedImages = await kv.hgetall<Record<string, string>>('shared:imgfields:bloodline') ?? {};
                for (const bl of bloodlineEntries) {
                    if (!bl.image && sharedImages[`bloodline:${bl.id}`]) {
                        bl.image = sharedImages[`bloodline:${bl.id}`];
                    }
                }
            } catch {
                // non-fatal — images just won't be restored
            }
        }

        // Sort: online first, then by lastSeen descending, then alphabetically
        players.sort((a, b) => {
            if (a.online !== b.online) return a.online ? -1 : 1;
            if (b.lastSeen !== a.lastSeen) return b.lastSeen - a.lastSeen;
            return a.name.localeCompare(b.name);
        });

        return res.status(200).json({ players, bloodlines: bloodlineEntries });
    } catch (err) {
        return res.status(500).json({ error: String(err) });
    }
}
