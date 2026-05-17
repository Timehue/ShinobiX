import type { VercelRequest, VercelResponse } from '@vercel/node';
import { kv } from '@vercel/kv';
import { cors } from '../_utils.js';

// Key patterns to wipe (player data, presence, chats, clans, guard queues)
const WIPE_PATTERNS = [
    'presence:*',
    'challenges:*',
    'chat:village:*',
    'clan:*',
    'guard:*',
];

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

        const deleted: string[] = [];

        // 1. Wipe all player saves — but KEEP admin saves (save:admin*) so
        //    admin-created content (jutsus, AIs, missions, events, pets) survives.
        const saveKeys = await kv.keys('save:*');
        const playerSaveKeys = saveKeys.filter(k => !k.startsWith('save:admin'));
        if (playerSaveKeys.length > 0) {
            await Promise.all(playerSaveKeys.map(k => kv.del(k)));
            deleted.push(...playerSaveKeys);
        }

        // 2. Wipe presence, challenges, chat, clans, guard queue
        await Promise.all(
            WIPE_PATTERNS.map(async (pattern) => {
                const keys = await kv.keys(pattern);
                if (keys.length > 0) {
                    await Promise.all(keys.map(k => kv.del(k)));
                    deleted.push(...keys);
                }
            })
        );

        // Clear the player registry (players must re-register on next heartbeat/save)
        await kv.del('player:registry');
        deleted.push('player:registry');

        // shared:images:* keys are intentionally NOT touched — kage, elder, pet,
        // item, AI, avatar images all survive the reset.

        return res.status(200).json({
            ok: true,
            deletedCount: deleted.length,
            deleted,
        });
    } catch (err) {
        return res.status(500).json({ error: String(err) });
    }
}
