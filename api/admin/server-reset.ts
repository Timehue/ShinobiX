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
// EXCLUDED from wipe (preserved across resets):
//   • shared:images*  / shared:imgfields*  — ALL uploaded images:
//       avatars, pets, weapons, jutsus, items, cards, bloodlines, AIs,
//       events / visual-novel pages (vn: keys route to the 'event' bucket),
//       Hollow Gate shrine assets, world-map landmarks, leader portraits.
//   • save:admin*  — admin-created game content (jutsus, AIs, missions,
//       events, visual novels, pets, cards) lives under admin saves.
//   • admin:approvedBloodlines / admin:approvedItems — admin curation lists.
//   • game:village-leadership-images — Village Leaders tab config (names + portraits).
//   • game:weekly-boss-override — admin's chosen boss AI choice survives so
//       the next week's boss spawns the same way.
const WIPE_PATTERNS = [
    'presence:*',
    'presence:all',                 // bulk presence hash (cleared alongside individual keys)
    'challenges:*',
    'challenge-outgoing:*',
    'chat:village:*',
    'clan:*',
    'guard:*',
    'pvp:*',                        // active PvP sessions
    'auth:*',                       // player passwords — players re-register on next login
    'admin-lock:*',                 // short-lived admin locks (cleanup)
    'reset-signal:*',               // short-lived reset signals (cleanup)
    'lock:save:*',                  // per-save write locks (short TTL — cleanup)
    'rl:*',                         // cooldown / rate-limit keys (e.g. weekly-boss attack cooldown)
    'ratelimit:*',                  // legacy rate-limit windows
    'game:village-state:*',         // shared village treasury / notices / war records / seated Kage
    'game:arena:tournament',        // arena tournament bracket
    'game:arena:active-fights',     // arena spectator fight list
    'game:clan-pet-battle:*',       // pending clan pet battle challenges
    'game:weekly-boss-state',       // server-wide boss HP / damage / claim list
    'world:territory:*',            // sector territory ownership
    'world:war:*',                  // active village wars
    'kageChallenge:*',              // pending Kage-seat challenges
];

// Villages with NPC Kage + 3 Elders configured on the Village Leaders admin tab.
// Images live in game:village-leadership-images (preserved through resets).
// After wiping, we copy them into the shared:imgfields:misc hash under the
// leader:{village}:kage and leader:{village}:elder:{0|1|2} keys so portraits
// load instantly for every client without each one having to re-fetch the
// leadership blob.
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

        // 4. Re-seed Kage AND Elder portraits from the preserved
        //    game:village-leadership-images key into the shared:imgfields:misc hash
        //    so the NPC Kage / Elders show up correctly the moment a player
        //    visits the Town Hall after a reset — no waiting for cache hydration.
        //    The actual NPC NAMES come from the hardcoded villageLeadership map
        //    on the client; this step is just for portraits.
        let leaderReseed = 0;
        try {
            // The leadership blob has two shapes in the wild: `{ images: { ... } }`
            // (the wrapped form persisted via persistSharedGameState) and the
            // bare `{ [village]: { kage, elders } }` form (older direct writes).
            // Accept both.
            type VillageLeaders = { kage?: string; elders?: string[] };
            type LeadershipBlob =
                | { images?: Record<string, VillageLeaders> }
                | Record<string, VillageLeaders>;
            const raw = await kv.get<LeadershipBlob>('game:village-leadership-images');
            const images: Record<string, VillageLeaders> =
                (raw && typeof raw === 'object' && 'images' in raw && raw.images && typeof raw.images === 'object')
                    ? raw.images as Record<string, VillageLeaders>
                    : (raw as Record<string, VillageLeaders>) ?? {};

            const imgPayload: Record<string, string> = {};
            for (const village of KAGE_VILLAGES) {
                const v = images[village];
                if (!v) continue;
                if (v.kage) imgPayload[`leader:${village}:kage`] = v.kage;
                const elders = Array.isArray(v.elders) ? v.elders : [];
                for (let i = 0; i < Math.min(3, elders.length); i++) {
                    const elderImg = elders[i];
                    if (elderImg) imgPayload[`leader:${village}:elder:${i}`] = elderImg;
                }
            }
            if (Object.keys(imgPayload).length > 0) {
                await kv.hset('shared:imgfields:misc', imgPayload);
                leaderReseed = Object.keys(imgPayload).length;
            }
        } catch {
            // Non-fatal — portraits still load from game:village-leadership-images
            // via the per-client cache hydration on next /api/game-state fetch.
        }

        return res.status(200).json({
            ok: true,
            deletedCount: deleted.length,
            leadershipPortraitsReseeded: leaderReseed,
            deleted,
        });
    } catch (err) {
        return res.status(500).json({ error: String(err) });
    }
}
