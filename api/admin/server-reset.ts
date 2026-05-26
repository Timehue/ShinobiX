import type { VercelRequest, VercelResponse } from '@vercel/node';
import { kv } from '../_storage.js';
import { cors } from '../_utils.js';
import { safeEqual } from '../_auth.js';
import { enforceRateLimit } from '../_ratelimit.js';
import { RESERVED_USERNAMES } from '../player-auth.js';

// Usernames whose save, auth, and registry entries survive a full server
// reset. Sourced from the same RESERVED_USERNAMES set that gates registration,
// so adding a new protected account is a one-line change in player-auth.ts.
const PROTECTED_NAMES = Array.from(RESERVED_USERNAMES); // already lowercase
const PROTECTED_SAVE_KEYS = new Set(PROTECTED_NAMES.map((n) => `save:${n}`));
const PROTECTED_AUTH_KEYS = new Set(PROTECTED_NAMES.map((n) => `auth:${n}`));

function isProtectedKey(key: string): boolean {
    const lower = key.toLowerCase();
    return PROTECTED_SAVE_KEYS.has(lower) || PROTECTED_AUTH_KEYS.has(lower);
}

// Patterns wiped on full reset. Anything matching these is deleted.
// shared:images / shared:imgfields are intentionally excluded — all uploaded
// images (kage portraits, elder portraits, pets, weapons, avatars) survive.
// save:admin* is excluded — admin-created content (jutsus, AIs, missions,
// events, pets, cards, visual novels) survives.
// admin:approvedBloodlines and admin:approvedItems survive — admin curation lists preserved.
// game:village-leadership-images survives — uploaded leader portraits preserved.
const WIPE_PATTERNS = [
    'presence:*',
    'presence:all',             // bulk presence hash (cleared alongside individual keys)
    'challenges:*',
    'challenge-outgoing:*',
    'chat:village:*',
    'clan:*',
    'guard:*',
    'pvp:*',                    // active PvP sessions
    'auth:*',                   // player passwords — players re-register on next login
    'admin-lock:*',             // short-lived admin locks (cleanup)
    'reset-signal:*',           // short-lived reset signals (cleanup)
    'game:village-state:*',     // shared village treasury / notices / war records
    'game:arena:tournament',    // arena tournament bracket
    'game:arena:active-fights', // arena spectator fight list
    'game:clan-pet-battle:*',   // pending clan pet battle challenges
    'world:territory:*',        // sector territory ownership
    'world:war:*',              // active village wars
];

// Village → KV image key for the default Kage portrait.
// Images are stored in game:village-leadership-images (preserved through resets).
// After wiping, we re-seed the shared imgfields hash so portraits load instantly.
const KAGE_VILLAGES = [
    'Stormveil Village',
    'Ashen Leaf Village',
    'Frostfang Village',
    'Moonshadow Village',
] as const;

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();

    // Rate-limit: server-reset is destructive; allow only a handful per hour.
    if (!enforceRateLimit(req, res, 'admin-server-reset', 5, 60 * 60_000)) return;

    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        const { password } = body as { password?: string };

        const adminPassword = process.env.ADMIN_PASSWORD;
        if (!adminPassword || !password || !safeEqual(password, adminPassword)) {
            return res.status(401).json({ error: 'Unauthorized.' });
        }

        const deleted: string[] = [];

        // 1. Wipe all player saves — admin saves are preserved so admin-created
        //    content (jutsus, AIs, missions, events, pets, cards, VNs) survives.
        //    Reserved usernames (PROTECTED_NAMES, e.g. Rill) are also preserved.
        const saveKeys = await kv.keys('save:*');
        const playerSaveKeys = saveKeys.filter((k) => {
            const lower = k.toLowerCase();
            if (lower.startsWith('save:admin')) return false;
            if (isProtectedKey(k)) return false;
            return true;
        });
        if (playerSaveKeys.length > 0) {
            await Promise.all(playerSaveKeys.map(k => kv.del(k)));
            deleted.push(...playerSaveKeys);
        }

        // 2. Wipe all other reset patterns in parallel.
        //    Protected auth records (auth:rill, etc.) skip the auth:* wipe so
        //    the protected accounts don't have to re-register after a reset.
        await Promise.all(
            WIPE_PATTERNS.map(async (pattern) => {
                const keys = await kv.keys(pattern);
                const targets = keys.filter((k) => !isProtectedKey(k));
                if (targets.length > 0) {
                    await Promise.all(targets.map(k => kv.del(k)));
                    deleted.push(...targets);
                }
            })
        );

        // 3. Clear the player registry, then re-seed entries for protected
        //    accounts that still have a save blob so they show up in player
        //    lists immediately rather than only after their next save.
        await kv.del('player:registry');
        deleted.push('player:registry');
        for (const name of PROTECTED_NAMES) {
            try {
                const saveBlob = await kv.get<Record<string, unknown>>(`save:${name}`);
                const char = (saveBlob?.character ?? null) as Record<string, unknown> | null;
                if (!char) continue;
                const registryEntry = {
                    name: String(char.name ?? name),
                    level: Number(char.level ?? 1),
                    village: String(char.village ?? ''),
                    specialty: String(char.specialty ?? ''),
                    lastSeenAt: Date.now(),
                };
                await kv.hset('player:registry', { [name]: registryEntry });
            } catch {
                // Non-fatal — protected account will re-register itself on next save.
            }
        }

        // 4. Re-seed Kage portraits from the preserved game:village-leadership-images key
        //    into the shared:imgfields:misc hash so portraits load immediately for all players.
        try {
            type LeadershipImages = Record<string, { kage?: string; elders?: string[] }>;
            const leadershipData = await kv.get<{ images?: LeadershipImages }>('game:village-leadership-images');
            const images = leadershipData?.images ?? {};
            const imgPayload: Record<string, string> = {};
            for (const village of KAGE_VILLAGES) {
                const kageImg = images[village]?.kage;
                if (kageImg) imgPayload[`leader:${village}:kage`] = kageImg;
            }
            if (Object.keys(imgPayload).length > 0) {
                await kv.hset('shared:imgfields:misc', imgPayload);
            }
        } catch {
            // Non-fatal — portraits still load from game:village-leadership-images
        }

        return res.status(200).json({
            ok: true,
            deletedCount: deleted.length,
            deleted,
        });
    } catch (err) {
        return res.status(500).json({ error: String(err) });
    }
}
