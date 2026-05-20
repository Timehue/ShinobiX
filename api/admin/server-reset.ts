import type { VercelRequest, VercelResponse } from '@vercel/node';
import { kv } from '@vercel/kv';
import { cors } from '../_utils.js';

// Patterns wiped on full reset. Anything matching these is deleted.
// shared:images / shared:imgfields are intentionally excluded — all uploaded
// images (kage portraits, elder portraits, pets, weapons, avatars) survive.
// save:admin* is excluded — admin-created content (jutsus, AIs, missions,
// events, pets, cards, visual novels) survives.
// admin:approvedBloodlines survives — admin curation list is preserved.
const WIPE_PATTERNS = [
    'presence:*',
    'challenges:*',
    'chat:village:*',
    'clan:*',
    'guard:*',
    'pvp:*',           // active PvP sessions
    'village:kage:*',  // per-village kage unlock / seated kage
    'auth:*',          // player passwords — players re-register on next login
    'admin-lock:*',    // short-lived admin locks (cleanup)
    'reset-signal:*',  // short-lived reset signals (cleanup)
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

        // 1. Wipe all player saves — admin saves are preserved so admin-created
        //    content (jutsus, AIs, missions, events, pets, cards, VNs) survives.
        const saveKeys = await kv.keys('save:*');
        const playerSaveKeys = saveKeys.filter(k => !k.toLowerCase().startsWith('save:admin'));
        if (playerSaveKeys.length > 0) {
            await Promise.all(playerSaveKeys.map(k => kv.del(k)));
            deleted.push(...playerSaveKeys);
        }

        // 2. Wipe all other reset patterns in parallel
        await Promise.all(
            WIPE_PATTERNS.map(async (pattern) => {
                const keys = await kv.keys(pattern);
                if (keys.length > 0) {
                    await Promise.all(keys.map(k => kv.del(k)));
                    deleted.push(...keys);
                }
            })
        );

        // 3. Clear the player registry
        await kv.del('player:registry');
        deleted.push('player:registry');

        return res.status(200).json({
            ok: true,
            deletedCount: deleted.length,
            deleted,
        });
    } catch (err) {
        return res.status(500).json({ error: String(err) });
    }
}
