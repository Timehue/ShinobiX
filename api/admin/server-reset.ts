import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { kv } from '../_storage.js';
import { cors } from '../_utils.js';
import { isFullAdmin, rotatePlayerSessionEpoch } from '../_auth.js';
import { enforceRateLimit } from '../_ratelimit.js';
import { RESERVED_USERNAMES } from '../player-auth.js';
import { bumpImageVersion } from '../_image-version.js';

/*
 * ── Full server reset — PRESERVE-LIST model ──────────────────────────────────
 *
 * This used to be an allow-list of WIPE_PATTERNS: "delete anything matching
 * these ~40 globs". That model rots silently. Every new subsystem invents a key
 * namespace, nobody remembers to add it here, and the pattern list falls behind
 * the codebase with no test able to notice — the only guard was a test that
 * checked the list against ITSELF. An audit of the live store on 2026-09-03
 * found ~795 live rows that a "full reset" left behind: every player's
 * `legacy:*` progression, their `ledger:currency:*` rows, permanent
 * `tower-firstclear:*` receipts (so a returning player could never earn a first
 * clear again), `petladder:*:def:*` ghost defence teams, clan-boss history for
 * clans that had just been deleted, and the `era:`/`econ:`/`war:eco:` world
 * aggregates.
 *
 * So the model is inverted. Everything in the store is per-era world/player
 * state and gets wiped UNLESS it matches PRESERVE_PATTERNS below. A namespace
 * added tomorrow is therefore reset by DEFAULT; the only list that must stay
 * accurate is the short, stable one describing the admin's own work, and that
 * list is verified by `POST { dryRun: true }` before any destructive run.
 *
 * The trade is deliberate: the old failure mode leaked a player's old life into
 * the new world with no signal. This one can only ever delete something the
 * admin still wanted — which the dry run shows them first, and which
 * `save-snapshot:*` (preserved) can restore.
 */

// Usernames whose account and per-player side-car state survive a full reset.
// Sourced from the same RESERVED_USERNAMES set that gates registration, so
// adding a new protected account is a one-line change in player-auth.ts.
const PROTECTED_NAMES = Array.from(RESERVED_USERNAMES); // already lowercase
const PROTECTED_NAME_SET = new Set(PROTECTED_NAMES);

/**
 * Keys that survive a full reset. Matching is lowercase; a trailing `*` is a
 * prefix match, anything else is an exact key.
 *
 * Read this as "the admin's work + the infrastructure a reset must not break".
 * Everything absent from this list is per-era state and is deleted.
 */
export const PRESERVE_PATTERNS: readonly string[] = [
    // ── Uploaded images (avatars, pets, weapons, jutsu, items, cards,
    //    bloodlines, AIs, event/VN pages, shrine art, world-map landmarks,
    //    leader portraits) and their manifests + cache-busting versions.
    // NOTE the two entries: `shared:images` is "ima", not "img", so it is NOT
    // covered by `shared:img*`. Losing that one blob would lose the image set.
    'shared:images*',
    'shared:img*',                      // shared:img:, shared:imgfields:, shared:imgver:
    'asset:*',                          // asset:meta:<id> — the asset registry's metadata layer
    'img-owner:*',                      // per-image ownership records
    'image-registry',
    // NOTE: `shared:village-war:*` and `shared:sector-war*` are NOT images —
    // they are live war state and are deliberately NOT preserved here.

    // ── Admin-authored game content.
    'save:admin1',                      // exact slots (isAdminContentSlot) — NOT a `save:admin` prefix,
    'save:admin2',                      // which would also spare a player who registered "adminx".
    'admin:*',                          // admin:approvedBloodlines / admin:approvedItems
    'shared:ai-profiles*',              // legacy authored AI content
    'shared:legacy-defs',               // authored legacy definitions
    'game:village-leadership-images',   // Village Leaders tab config (names + portraits)
    'game:weekly-boss-override',        // admin's chosen weekly boss
    // Permanent forged/named-item DEFINITIONS. Keyed by item id, not by player,
    // so they cannot be scoped to a protected account — and a protected account
    // that keeps its save would otherwise be left holding gear whose definition
    // no longer resolves (PvP silently drops unresolvable items). Orphaned defs
    // for deleted players are inert rows, so preserving all of them is the
    // cheap side of that trade.
    'forged-item:*',
    'named-forge:*',

    // ── Backups and restore machinery. The whole point of a reset being
    //    survivable.
    'save-snapshot:*',
    'backup:*',
    'maxout-backup:*',

    // ── Save-deletion fences. These are the high-water marks that stop a
    //    deleted save being resurrected by an in-flight client write
    //    (api/save/[name].ts playerSaveDeletionFenceKey). Wiping them would
    //    WEAKEN the reset, not clean it.
    'save-delete-version:*',

    // ── Session epochs. Rotated (not deleted) by this handler: a missing epoch
    //    reads as zero and could revive an old epoch-0 token whose password row
    //    is already gone.
    'auth-session:*',

    // ── Moderation and safety. Bans, ban indexes, the player report queue and
    //    the custom-title review log are the admin's work and must outlive any
    //    world. Same for the IP/fingerprint trail that ban-evasion detection
    //    reads.
    'mod:*',
    'reports:queue',
    'titles:custom-log',
    'player-ip:*',
    'player-fp:*',

    // ── Records. Audit logs, historical analytics rollups, and real-money
    //    payment state.
    'audit:*',
    'beta:metrics:*',                   // daily rollups; the per-player `beta:funnel:*` NX gates are wiped
                                        // so the new era's players count as fresh crossings
    'tebex:*',

    // ── Scheduler leases. Wiping these would let an already-completed weekly /
    //    daily job run a second time immediately after the reset.
    'cron:lease:*',
];

/**
 * Namespaces that are wiped even when the key names a protected account. These
 * hold live session / lock / presence state, where preserving a row for a
 * protected account would leave a ghost (a phantom presence entry, a lock
 * nobody holds, a pending challenge to a player who no longer exists).
 */
export const EPHEMERAL_PREFIXES: readonly string[] = [
    'presence:',
    'challenges:',
    'challenge-outgoing:',
    'chat:',
    'pvp:',
    'lock:',
    'battle-lock:',
    'admin-lock:',
    'reset-signal:',
    'rl:',
    'ratelimit:',
    'heal-signal:',
    'training-active:',
    'training-token:',
    'pet-encounter-active:',
    'pet-encounter-request:',
    'pet-encounter-attempt:',
];

function matchesPattern(lowerKey: string, pattern: string): boolean {
    if (pattern.endsWith('*')) return lowerKey.startsWith(pattern.slice(0, -1));
    return lowerKey === pattern;
}

/**
 * True when `key` names a protected account in any of its colon segments —
 * `save:rill`, `auth:rill`, `story:rill`, `ledger:currency:rill`,
 * `legacy:stats:rill`, `tower-firstclear:rill:7`, `weekly-board:rill:w138`…
 *
 * Segment-wise rather than prefix-wise because per-player side-car keys put the
 * player name in a different position in every namespace. A composite segment
 * like `dm:thread:dopey|rill` deliberately does NOT match: that thread's other
 * participant is gone, so the thread goes with them.
 */
export function isProtectedAccountKey(key: string): boolean {
    return key.toLowerCase().split(':').some((segment) => PROTECTED_NAME_SET.has(segment));
}

/** True when `key` survives a full reset. */
export function isPreservedKey(key: string): boolean {
    const lower = key.toLowerCase();
    if (EPHEMERAL_PREFIXES.some((prefix) => lower.startsWith(prefix))) return false;
    if (PRESERVE_PATTERNS.some((pattern) => matchesPattern(lower, pattern))) return true;
    return isProtectedAccountKey(lower);
}

/**
 * Back-compat wrapper for the original narrow predicate (save/auth/story rows
 * of a protected account). `isPreservedKey` is the one the handler uses.
 */
export function isProtectedKey(key: string): boolean {
    const lower = key.toLowerCase();
    if (!/^(save|auth|story):/.test(lower)) return false;
    return PROTECTED_NAME_SET.has(lower.slice(lower.indexOf(':') + 1));
}

export function authNamesRequiringRevocation(authKeys: readonly string[]): string[] {
    // `auth:` and not `auth-google:` / `auth-recovery:` / `auth-session:` —
    // a LIKE scan stops at the colon, so the prefix test already separates them.
    return authKeys
        .filter((key) => key.toLowerCase().startsWith('auth:') && !isPreservedKey(key))
        .map((key) => key.slice('auth:'.length))
        .filter(Boolean);
}

/**
 * Grouping label for the dry-run report: the leading namespace segment.
 *
 * Deliberately just the first segment. A heuristic that also kept the second
 * cannot tell a sub-namespace (`ledger:currency:…`) from a player name
 * (`tower-firstclear:dopey:…`), and guessing wrong turns the report into one
 * row per player — the opposite of a summary.
 */
export function namespaceOf(key: string): string {
    const head = key.split(':')[0];
    return head || key;
}

export function summarizeByNamespace(keys: readonly string[]): Record<string, number> {
    const out: Record<string, number> = {};
    for (const key of keys) {
        const ns = namespaceOf(key.toLowerCase());
        out[ns] = (out[ns] ?? 0) + 1;
    }
    return out;
}

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

// Delete in batches rather than one request per key. kv.del takes varargs and
// chunks internally; a per-key Promise.all fired thousands of key deletes at a
// 15-connection pool.
const DELETE_CHUNK = 200;
/*
 * The store scan. `*` alone is enough on Railway, where `kv` IS the base store.
 * It is NOT enough if the (currently dormant) cPanel disk overlay is ever
 * re-enabled for a rollback: the routing wrapper picks a backend by PATTERN, and
 * a bare `*` matches no disk-routed prefix, so it would resolve to the base
 * store only and a "full reset" would silently leave every player save behind.
 * Scanning the disk-routed prefixes explicitly and unioning makes this correct
 * under either topology, at the cost of two extra reads.
 */
const SCAN_PATTERNS = ['*', 'save:*', 'shared:*'] as const;
// How many sample keys the response carries. The full list can be ~10k entries
// on a live store, which is a multi-megabyte response nobody reads.
const DELETED_SAMPLE_CAP = 200;

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();

    // Rate-limit FIRST, before the password check — this bucket is what caps
    // admin-password guessing against this endpoint, so an unauthenticated
    // caller must spend budget to make an attempt. The dry run is charged the
    // same way and against the same bucket on purpose: giving previews a
    // roomier bucket would hand an attacker a roomier brute-force allowance,
    // since the flag is read from an unauthenticated body. 5/hour still covers
    // two full preview-then-reset cycles.
    if (!enforceRateLimit(req, res, 'admin-server-reset', 5, 60 * 60_000)) return;

    // Full admin (Admin 1) only — destructive endpoint. Admin password via
    // x-admin-password header (was body — see players.ts for the migration
    // rationale).
    if (!isFullAdmin(req)) {
        return res.status(401).json({ error: 'Unauthorized.' });
    }

    const body = (req.body ?? {}) as { dryRun?: unknown };
    const dryRun = body.dryRun === true;

    try {
        // One scan of the whole store, partitioned by the preserve list. This
        // is what makes a new namespace reset by default.
        const scans = await Promise.all(SCAN_PATTERNS.map((pattern) => kv.keys(pattern)));
        const allKeys = Array.from(new Set(scans.flat()));
        const doomed: string[] = [];
        const preserved: string[] = [];
        for (const key of allKeys) (isPreservedKey(key) ? preserved : doomed).push(key);

        if (dryRun) {
            return res.status(200).json({
                ok: true,
                dryRun: true,
                totalKeys: allKeys.length,
                deletedCount: doomed.length,
                preservedCount: preserved.length,
                wouldDeleteByNamespace: summarizeByNamespace(doomed),
                wouldPreserveByNamespace: summarizeByNamespace(preserved),
                deleted: doomed.slice(0, DELETED_SAMPLE_CAP),
                deletedTruncated: doomed.length > DELETED_SAMPLE_CAP,
            });
        }

        // Revoke every affected account token before the first destructive
        // write. The rotated epoch deliberately survives the reset (see
        // `auth-session:*` in PRESERVE_PATTERNS).
        const authNames = authNamesRequiringRevocation(doomed);
        await Promise.all(authNames.map((name) => rotatePlayerSessionEpoch(name)));

        for (let i = 0; i < doomed.length; i += DELETE_CHUNK) {
            await kv.del(...doomed.slice(i, i + DELETE_CHUNK));
        }

        // Re-seed registry entries for protected accounts that still have a
        // save blob so they show up in player lists immediately rather than
        // only after their next save. (`player:registry` itself is not
        // preserved, so the sweep above already removed it.)
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

        // Re-seed Kage AND Elder portraits from the preserved
        // game:village-leadership-images key into the shared:imgfields:misc hash
        // so the NPC Kage / Elders show up correctly the moment a player
        // visits the Town Hall after a reset — no waiting for cache hydration.
        // The actual NPC NAMES come from the hardcoded villageLeadership map
        // on the client; this step is just for portraits.
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
                // Reseeded portraits are new bytes behind existing ids, so the
                // immutable /api/img URLs holding the old ones have to retire
                // (api/_image-version.ts). These land in the `misc` hash but are
                // served as the `leader` category, and the leader manifest reads
                // both — so both counters move.
                await bumpImageVersion('leader');
                await bumpImageVersion('misc');
            }
        } catch {
            // Non-fatal — portraits still load from game:village-leadership-images
            // via the per-client cache hydration on next /api/game-state fetch.
        }

        return res.status(200).json({
            ok: true,
            dryRun: false,
            totalKeys: allKeys.length,
            deletedCount: doomed.length,
            preservedCount: preserved.length,
            sessionsRevoked: authNames.length,
            deletedByNamespace: summarizeByNamespace(doomed),
            leadershipPortraitsReseeded: leaderReseed,
            deleted: doomed.slice(0, DELETED_SAMPLE_CAP),
            deletedTruncated: doomed.length > DELETED_SAMPLE_CAP,
        });
    } catch (err) {
        console.error('[admin/server-reset]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
