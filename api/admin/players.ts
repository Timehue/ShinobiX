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

        // Fallback: also scan save:* for any accounts not yet in the registry
        if (players.length === 0) {
            const saveKeys = await kv.keys('save:*');
            for (const key of saveKeys) {
                const name = key.replace('save:', '');
                if (players.some(p => p.name.toLowerCase() === name.toLowerCase())) continue;
                try {
                    const snap = await kv.get<Record<string, unknown>>(key);
                    const char = snap?.character as Record<string, unknown> | undefined;
                    players.push({
                        name: (char?.name as string) ?? name,
                        level: (char?.level as number) ?? 1,
                        village: (char?.village as string) ?? '',
                        specialty: (char?.specialty as string) ?? '',
                        lastSeen: 0,
                        online: onlineNames.has(name.toLowerCase()),
                    });
                } catch {
                    players.push({ name, level: 1, village: '', specialty: '', lastSeen: 0, online: onlineNames.has(name.toLowerCase()) });
                }
            }
        }

        // Sort: online first, then by lastSeen descending, then alphabetically
        players.sort((a, b) => {
            if (a.online !== b.online) return a.online ? -1 : 1;
            if (b.lastSeen !== a.lastSeen) return b.lastSeen - a.lastSeen;
            return a.name.localeCompare(b.name);
        });

        return res.status(200).json({ players });
    } catch (err) {
        return res.status(500).json({ error: String(err) });
    }
}
