import type { VercelRequest, VercelResponse } from '@vercel/node';
import { kv } from '@vercel/kv';
import { cors } from '../_utils.js';

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

        // Scan all save keys to get every account that has ever synced
        const saveKeys = await kv.keys('save:*');
        // Also pull presence keys for online status
        const presenceKeys = await kv.keys('presence:*');
        const onlineNames = new Set(presenceKeys.map(k => k.replace('presence:', '').toLowerCase()));

        // Extract name from save key and fetch basic info from the save
        const players = await Promise.all(
            saveKeys.map(async (key) => {
                const name = key.replace('save:', '');
                try {
                    const snap = await kv.get<Record<string, unknown>>(key);
                    const char = snap?.character as Record<string, unknown> | undefined;
                    return {
                        name,
                        level: (char?.level as number) ?? 1,
                        village: (char?.village as string) ?? '',
                        specialty: (char?.specialty as string) ?? '',
                        online: onlineNames.has(name.toLowerCase()),
                    };
                } catch {
                    return { name, level: 1, village: '', specialty: '', online: false };
                }
            })
        );

        // Sort: online first, then alphabetically
        players.sort((a, b) => {
            if (a.online !== b.online) return a.online ? -1 : 1;
            return a.name.localeCompare(b.name);
        });

        return res.status(200).json({ players });
    } catch (err) {
        return res.status(500).json({ error: String(err) });
    }
}
