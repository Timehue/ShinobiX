"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
const _storage_js_1 = require("../_storage.js");
const _utils_js_1 = require("../_utils.js");
const _auth_js_1 = require("../_auth.js");
const _ratelimit_js_1 = require("../_ratelimit.js");
const player_auth_js_1 = require("../player-auth.js");
// Usernames whose save, auth, and registry entries survive a full server
// reset. Sourced from the same RESERVED_USERNAMES set that gates registration,
// so adding a new protected account is a one-line change in player-auth.ts.
const PROTECTED_NAMES = Array.from(player_auth_js_1.RESERVED_USERNAMES); // already lowercase
const PROTECTED_SAVE_KEYS = new Set(PROTECTED_NAMES.map((n) => `save:${n}`));
const PROTECTED_AUTH_KEYS = new Set(PROTECTED_NAMES.map((n) => `auth:${n}`));
function isProtectedKey(key) {
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
    'presence:all', // bulk presence hash (cleared alongside individual keys)
    'challenges:*',
    'challenge-outgoing:*',
    'chat:village:*',
    'clan:*',
    'guard:*',
    'pvp:*', // active PvP sessions
    'auth:*', // player passwords — players re-register on next login
    'admin-lock:*', // short-lived admin locks (cleanup)
    'reset-signal:*', // short-lived reset signals (cleanup)
    'lock:save:*', // per-save write locks (short TTL — cleanup)
    'rl:*', // cooldown / rate-limit keys (e.g. weekly-boss attack cooldown)
    'ratelimit:*', // legacy rate-limit windows
    'game:village-state:*', // shared village treasury / notices / war records / seated Kage
    'game:arena:tournament', // arena tournament bracket
    'game:arena:active-fights', // arena spectator fight list
    'game:clan-pet-battle:*', // pending clan pet battle challenges
    'game:weekly-boss-state', // server-wide boss HP / damage / claim list
    'world:territory:*', // sector territory ownership
    'world:war:*', // active village wars
    'kageChallenge:*', // pending Kage-seat challenges
    // Authoritative Kage record per village. Lives separately from the
    // village-state view above — validateVillageStateWrite re-injects the
    // seated Kage from THIS key on every write, so unless we wipe it the
    // village-state's seatedKage field gets rehydrated right back after
    // every game:village-state:* clear. (This is what kept a stale Kage
    // seated through a server reset.)
    'village:kage:*',
    // ── Per-player ephemeral state added since this list was first written.
    // All are TTL-backed (self-expire), but a full reset should zero them
    // immediately so a wiped player starts truly clean. These are dedup /
    // counter / transient keys — NOT admin content (which lives under
    // save:admin* / shared:* / admin:*, none of which is touched here).
    'missions:daily:*', // per-player daily mission progress
    'missions:raid-reported:*', // per-player village-raid report dedup
    'pet:reported:*', // per-player pet-battle anti-replay dedup
    'raid-token:*', // per-player raid anti-replay tokens
    'raid-report-count:*', // per-player daily raid-report counters
    'raid-start-count:*', // per-player daily raid-start counters
    'chat:battle:*', // transient PvP battle chat logs
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
];
async function handler(req, res) {
    (0, _utils_js_1.cors)(res, req);
    if (req.method === 'OPTIONS')
        return res.status(200).end();
    if (req.method !== 'POST')
        return res.status(405).end();
    // Rate-limit: server-reset is destructive; allow only a handful per hour.
    if (!(0, _ratelimit_js_1.enforceRateLimit)(req, res, 'admin-server-reset', 5, 60 * 60_000))
        return;
    // Full admin (Admin 1) only — destructive endpoint. Admin password via
    // x-admin-password header (was body — see players.ts for the migration
    // rationale).
    if (!(0, _auth_js_1.isFullAdmin)(req)) {
        return res.status(401).json({ error: 'Unauthorized.' });
    }
    try {
        const deleted = [];
        // 1. Wipe all player saves — admin saves are preserved so admin-created
        //    content (jutsus, AIs, missions, events, pets, cards, VNs) survives.
        //    Reserved usernames (PROTECTED_NAMES, e.g. Rill) are also preserved.
        const saveKeys = await _storage_js_1.kv.keys('save:*');
        const playerSaveKeys = saveKeys.filter((k) => {
            const lower = k.toLowerCase();
            if (lower.startsWith('save:admin'))
                return false;
            if (isProtectedKey(k))
                return false;
            return true;
        });
        if (playerSaveKeys.length > 0) {
            await Promise.all(playerSaveKeys.map(k => _storage_js_1.kv.del(k)));
            deleted.push(...playerSaveKeys);
        }
        // 2. Wipe all other reset patterns in parallel.
        //    Protected auth records (auth:rill, etc.) skip the auth:* wipe so
        //    the protected accounts don't have to re-register after a reset.
        await Promise.all(WIPE_PATTERNS.map(async (pattern) => {
            const keys = await _storage_js_1.kv.keys(pattern);
            const targets = keys.filter((k) => !isProtectedKey(k));
            if (targets.length > 0) {
                await Promise.all(targets.map(k => _storage_js_1.kv.del(k)));
                deleted.push(...targets);
            }
        }));
        // 3. Clear the player registry, then re-seed entries for protected
        //    accounts that still have a save blob so they show up in player
        //    lists immediately rather than only after their next save.
        await _storage_js_1.kv.del('player:registry');
        deleted.push('player:registry');
        for (const name of PROTECTED_NAMES) {
            try {
                const saveBlob = await _storage_js_1.kv.get(`save:${name}`);
                const char = (saveBlob?.character ?? null);
                if (!char)
                    continue;
                const registryEntry = {
                    name: String(char.name ?? name),
                    level: Number(char.level ?? 1),
                    village: String(char.village ?? ''),
                    specialty: String(char.specialty ?? ''),
                    lastSeenAt: Date.now(),
                };
                await _storage_js_1.kv.hset('player:registry', { [name]: registryEntry });
            }
            catch {
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
            const raw = await _storage_js_1.kv.get('game:village-leadership-images');
            const images = (raw && typeof raw === 'object' && 'images' in raw && raw.images && typeof raw.images === 'object')
                ? raw.images
                : raw ?? {};
            const imgPayload = {};
            for (const village of KAGE_VILLAGES) {
                const v = images[village];
                if (!v)
                    continue;
                if (v.kage)
                    imgPayload[`leader:${village}:kage`] = v.kage;
                const elders = Array.isArray(v.elders) ? v.elders : [];
                for (let i = 0; i < Math.min(3, elders.length); i++) {
                    const elderImg = elders[i];
                    if (elderImg)
                        imgPayload[`leader:${village}:elder:${i}`] = elderImg;
                }
            }
            if (Object.keys(imgPayload).length > 0) {
                await _storage_js_1.kv.hset('shared:imgfields:misc', imgPayload);
                leaderReseed = Object.keys(imgPayload).length;
            }
        }
        catch {
            // Non-fatal — portraits still load from game:village-leadership-images
            // via the per-client cache hydration on next /api/game-state fetch.
        }
        return res.status(200).json({
            ok: true,
            deletedCount: deleted.length,
            leadershipPortraitsReseeded: leaderReseed,
            deleted,
        });
    }
    catch (err) {
        console.error('[admin/server-reset]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
