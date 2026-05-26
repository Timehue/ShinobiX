import type { VercelRequest, VercelResponse } from '@vercel/node';
import { kv } from '../_storage.js';
import { safeName, mergePreservingImages, cors } from '../_utils.js';
import { verifyPlayerPassword } from '../player-auth.js';
import { authedPlayerOrAdmin, isAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';

// Fields stripped from character objects when a non-owner reads another player's save.
// Prevents ryo farming (reading other players' wallets) and inventory snooping.
const PRIVATE_CHAR_FIELDS = [
    'ryo', 'bankedRyo', 'inventory', 'missions', 'missionLog',
    'completedMissions', 'activeMissions', 'questLog', 'bankLog',
] as const;

// Public-safe subset used when ANY player reads another player's save.
// Avoids leaking PvP loadout (jutsu, equipment, computed combat multipliers)
// which an attacker could use to scout opponents and metagame them.
const PUBLIC_CHAR_FIELDS = new Set<string>([
    'name', 'level', 'village', 'rank', 'avatarImage', 'specialty', 'storyProgress',
    'hp', 'maxHp', 'chakra', 'maxChakra', 'stamina', 'maxStamina',
    'customTitle', 'hospitalized', 'hospitalizedUntil',
]);

function publicProjection(data: Record<string, unknown>): Record<string, unknown> {
    const char = data.character as Record<string, unknown> | undefined;
    if (!char || typeof char !== 'object') return data;
    const projected: Record<string, unknown> = {};
    for (const k of PUBLIC_CHAR_FIELDS) {
        if (k in char) projected[k] = char[k];
    }
    return { ...data, character: projected };
}

function stripPrivateFields(data: Record<string, unknown>): Record<string, unknown> {
    const char = data.character as Record<string, unknown> | undefined;
    if (!char || typeof char !== 'object') return data;
    const sanitized = { ...char };
    for (const field of PRIVATE_CHAR_FIELDS) delete sanitized[field];
    return { ...data, character: sanitized };
}

const REGISTRY_KEY = 'player:registry';

// ─── Save sanitization ────────────────────────────────────────────────────────
// Applied to every non-admin player save to prevent client-side economy cheating.
// Caps per-save *gains* rather than imposing hard ceilings, so legitimate large
// values (high-level players with lots of ryo) are preserved while exploit spikes
// (editing localStorage / fetch body) are clamped.

const MAX_RYO_GAIN = 1_000_000;           // max ryo a player can earn per save cycle
const CURRENCY_CAPS: Record<string, number> = {
    fateShards: 50,
    boneCharms: 50,
    auraStones: 50,
    // NOTE: auraDust may clip legitimate rewards from bosses / events that grant
    // > 100 dust in a single save cycle. Tune this cap if players report missing dust.
    auraDust: 100,
    mythicSeals: 50,
    honorSeals: 200,
};
const MAX_STAT_GAIN = 500;   // per individual stat per save cycle
const MAX_LEVEL_GAIN = 5;    // levels that can be gained between saves
const LEVEL_CAP = 100;
// Server-side hospital downtime — clients can't skip it by editing localStorage.
const HOSPITAL_DURATION_MS = 60_000;

// Rolling 60-second gain windows. Anything above these caps is rejected with
// a 429. These are server-side rate limits independent of the per-save caps;
// they catch a stream of small but legitimate-looking saves that, in
// aggregate, are obviously farming.
const GAIN_WINDOW_MS = 60_000;
const MAX_RYO_PER_MINUTE = 5_000_000;
const MAX_STAT_PER_MINUTE = 1500; // any single stat
const MAX_XP_PER_MINUTE = 1_000_000;

type GainsWindow = { startedAt: number; ryo: number; stat: Record<string, number>; xp: number };

async function readGainsWindow(name: string): Promise<GainsWindow | null> {
    try {
        return await kv.get<GainsWindow>(`ratelimit:save:${name}:gains`);
    } catch {
        return null;
    }
}

async function writeGainsWindow(name: string, w: GainsWindow): Promise<void> {
    try {
        await kv.set(`ratelimit:save:${name}:gains`, w, { ex: Math.ceil(GAIN_WINDOW_MS / 1000) * 2 });
    } catch {
        // best-effort
    }
}

function freshWindow(): GainsWindow {
    return { startedAt: Date.now(), ryo: 0, stat: {}, xp: 0 };
}

// Baseline used to clamp a brand-new account's FIRST save. Without this, a
// fresh registration could submit a character at level 100 / millions of ryo /
// maxed stats because there's no `existing` baseline to diff against.
const FIRST_SAVE_BASELINE_CHARACTER: Record<string, unknown> = {
    level: 1,
    ryo: 0,
    xp: 0,
    stats: {
        strength: 0, speed: 0, intelligence: 0, willpower: 0,
        bukijutsuOffense: 0, bukijutsuDefense: 0,
        taijutsuOffense: 0, taijutsuDefense: 0,
        genjutsuOffense: 0, genjutsuDefense: 0,
        ninjutsuOffense: 0, ninjutsuDefense: 0,
    },
    honorSeals: 0, fateShards: 0, boneCharms: 0, auraStones: 0,
    auraDust: 0, mythicSeals: 0,
    hospitalized: false, hospitalizedUntil: 0,
};

function sanitizeCharacterSave(
    incoming: Record<string, unknown>,
    existing: Record<string, unknown> | null,
): Record<string, unknown> {
    const inChar = incoming.character as Record<string, unknown> | undefined;
    // First-save case (no existing): clamp against a fresh baseline so a brand-
    // new account can't submit absurd starting values.
    const exChar = (existing?.character as Record<string, unknown> | undefined) ?? FIRST_SAVE_BASELINE_CHARACTER;
    if (!inChar || typeof inChar !== 'object') return incoming;
    if (!exChar || typeof exChar !== 'object') return incoming;

    const char: Record<string, unknown> = { ...inChar };

    // Level: can't jump more than MAX_LEVEL_GAIN levels per save; hard cap at LEVEL_CAP.
    const exLevel = Math.max(1, Number(exChar.level ?? 1));
    const inLevel = Math.max(1, Number(char.level ?? 1));
    char.level = Math.min(LEVEL_CAP, Math.min(inLevel, exLevel + MAX_LEVEL_GAIN));

    // Ryo: cap the gain per cycle; can't go below zero.
    const exRyo = Math.max(0, Number(exChar.ryo ?? 0));
    const inRyo = Math.max(0, Number(char.ryo ?? 0));
    char.ryo = Math.min(inRyo, exRyo + MAX_RYO_GAIN);

    // Soft currencies: same gain-cap pattern.
    for (const [key, maxGain] of Object.entries(CURRENCY_CAPS)) {
        const exVal = Math.max(0, Number(exChar[key] ?? 0));
        const inVal = Math.max(0, Number(char[key] ?? 0));
        char[key] = Math.min(inVal, exVal + maxGain);
    }

    // Individual stats: can't gain more than MAX_STAT_GAIN per stat per save.
    const inStats = char.stats as Record<string, number> | undefined;
    const exStats = exChar.stats as Record<string, number> | undefined;
    if (inStats && typeof inStats === 'object' && exStats && typeof exStats === 'object') {
        const s: Record<string, number> = { ...inStats };
        for (const k of Object.keys(s)) {
            const exV = Math.max(0, Number(exStats[k] ?? 0));
            s[k] = Math.min(Math.max(0, Number(s[k] ?? 0)), exV + MAX_STAT_GAIN);
        }
        char.stats = s;
    }

    // HP / chakra / stamina must not exceed their own max fields.
    if (Number(char.hp ?? 0) > Number(char.maxHp ?? char.hp)) char.hp = char.maxHp;
    if (Number(char.chakra ?? 0) > Number(char.maxChakra ?? char.chakra)) char.chakra = char.maxChakra;
    if (Number(char.stamina ?? 0) > Number(char.maxStamina ?? char.stamina)) char.stamina = char.maxStamina;

    // Hospital timer enforcement.
    //   - If save flips hospitalized false → true, server stamps hospitalizedUntil.
    //   - If save flips hospitalized true → false before the timer expires, revert
    //     (with HP at zero — exactly the state they were in when admitted).
    const exHosp = !!exChar.hospitalized;
    const inHosp = !!char.hospitalized;
    const exHospUntil = Number(exChar.hospitalizedUntil ?? 0);
    if (!exHosp && inHosp) {
        char.hospitalizedUntil = Date.now() + HOSPITAL_DURATION_MS;
    } else if (exHosp && !inHosp) {
        if (exHospUntil && Date.now() < exHospUntil) {
            // Reject early discharge — force the player to wait out the timer
            // (or pay the discharge fee, which is a client-side flow that
            //  doesn't actually skip the timer either now).
            char.hospitalized = true;
            char.hospitalizedUntil = exHospUntil;
            // Snap HP back to 0 so they can't farm hp during the lockout.
            char.hp = 0;
        } else {
            // Timer expired or unset — allow discharge and clear the stamp.
            char.hospitalizedUntil = 0;
        }
    } else if (exHosp && inHosp) {
        // Preserve the original stamp — don't let the client refresh it.
        char.hospitalizedUntil = exHospUntil || char.hospitalizedUntil;
    }

    return { ...incoming, character: char };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();

    const name = safeName(String(req.query.name ?? ''));
    if (!name) return res.status(400).json({ error: 'Invalid name.' });

    const key = `save:${name}`;
    // Clan saves use `save:clan-<slug>` keys — they're shared per-clan, so any
    // logged-in player may read/write them. Admin actions still flow through
    // ?signal=1 which requires admin auth.
    const isClanSave = name.startsWith('clan-');

    if (req.method === 'GET') {
        // Reads require *some* auth — stops anonymous bots from scraping every
        // player's save by guessing names. Logged-in players can still read
        // other players' saves (needed for PvP opponent loading, clan record
        // lookups, etc.) but at least we know who's doing it.
        // Sensitive economy fields (ryo, inventory, etc.) are stripped for non-owners.
        const identity = await authedPlayerOrAdmin(req, name);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        const data = await kv.get<Record<string, unknown>>(key);
        if (data === null) return res.status(404).end();

        // Strip sensitive fields when someone reads another player's save.
        // - Owners + admins: full save.
        // - Clan saves: full save (any logged-in player can read shared clan record).
        // - Anyone else: public-only projection (name/level/village/HP/etc.).
        //   This drops PvP loadout (jutsu, pvpItems, equipment, armor*, bloodlineMult,
        //   itemDamagePct, stats, savedBloodlines, creatorJutsus, creatorItems)
        //   so opponents can't be scouted out-of-band. The server hydrates
        //   actual opponent combat data from save:<name> directly when PvP
        //   sessions are created.
        const isOwner = identity.admin || isClanSave || identity.name === name.toLowerCase().trim();
        const payload = isOwner ? data : publicProjection(stripPrivateFields(data));
        return res.status(200).json(payload);
    }

    if (req.method === 'POST') {
        try {
            const resetSignalKey = `reset-signal:${name.toLowerCase()}`;
            const adminLockKey = `admin-lock:${name.toLowerCase()}`;
            if (req.query.ack === '1') {
                // Ack just clears two short-lived keys for this player.
                const ackIdentity = await authedPlayerOrAdmin(req, name);
                if (!ackIdentity) return res.status(401).json({ error: 'Authentication required.' });
                if (!ackIdentity.admin && !isClanSave && ackIdentity.name !== name) {
                    return res.status(403).json({ error: 'Cannot ack another player.' });
                }
                await Promise.all([
                    kv.del(resetSignalKey),
                    kv.del(adminLockKey),
                ]);
                return res.status(200).json({ ok: true });
            }

            const isAdminSave = req.query.signal === '1';

            // Admin-flagged writes require admin auth (constant-time compare in isAdmin).
            let identityName: string | null = null;
            if (isAdminSave) {
                if (!isAdmin(req)) {
                    return res.status(401).json({ error: 'Admin authentication required.' });
                }
            } else {
                // Non-admin saves: player can save their own; clan saves are
                // gated by clan membership (the actor's character.clan must
                // match the clan-<slug> being written).
                const identity = await authedPlayerOrAdmin(req, name);
                if (!identity) return res.status(401).json({ error: 'Authentication required.' });
                if (!identity.admin && !isClanSave && identity.name !== name) {
                    return res.status(403).json({ error: 'Cannot save another player.' });
                }
                if (!identity.admin && isClanSave) {
                    // Verify the actor belongs to this clan before letting them
                    // mutate the shared clan record. The clan slug here is
                    // whatever follows "clan-" in the key path.
                    try {
                        const targetClanSlug = name.replace(/^clan-/, '').trim().toLowerCase();
                        const actorSave = await kv.get<Record<string, unknown>>(`save:${identity.name}`);
                        const actorChar = (actorSave?.character ?? null) as Record<string, unknown> | null;
                        const actorClan = String(actorChar?.clan ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
                        if (!actorClan || actorClan !== targetClanSlug) {
                            return res.status(403).json({ error: 'Only members of this clan can write its shared record.' });
                        }
                    } catch {
                        return res.status(500).json({ error: 'Unable to verify clan membership.' });
                    }
                }
                identityName = identity.admin ? null : identity.name;

                // Per-account rate limit: max 1 save per 3 seconds. Stops a
                // hostile client from hammering the save endpoint to amplify
                // gain caps. KV-backed so it survives serverless cold starts.
                if (!isClanSave && !(await enforceRateLimitKv(req, res, 'save-burst', 1, 3_000, identityName))) {
                    return; // 429 already written
                }
            }

            // If a reset-signal is pending (admin edit in-flight) and this is NOT the admin save,
            // silently drop the client auto-save so it can't overwrite admin changes.
            // Speculatively fetch the existing save in parallel with the signal checks —
            // saves one round-trip on every auto-save (the common path).
            const incoming = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
            if (!isAdminSave) {
                // ── Atomicity (finding 14) ─────────────────────────────────
                // Take a short-lived per-save lock around the read-modify-write
                // so concurrent saves can't trample each other. 2-second TTL
                // is plenty for the synchronous work below; lock is auto-released
                // at the end of the path or just expires.
                const writeLockKey = `lock:save:${name.toLowerCase()}`;
                if (!isClanSave) {
                    const lockOk = await kv.set(writeLockKey, '1', { nx: true, ex: 2 });
                    if (!lockOk) {
                        return res.status(429).json({ error: 'Concurrent save in flight. Retry.' });
                    }
                }

                try {
                    const [pendingSignal, adminLock, existing] = await Promise.all([
                        kv.get(resetSignalKey),
                        kv.get(adminLockKey),
                        kv.get(key),
                    ]);
                    if (pendingSignal || adminLock) return res.status(200).end();
                    // Sanitize before merge: caps per-save gains to prevent exploit spikes.
                    // Clan saves are collaborative (no single "owner" baseline), so we skip
                    // sanitization for them — they're already admin-locked in the UI.
                    // For brand-new accounts (no existing), sanitize against a zeroed
                    // baseline so a fresh registration can't submit absurd values.
                    const safeIncoming = (!isClanSave)
                        ? sanitizeCharacterSave(
                            incoming as Record<string, unknown>,
                            (existing as Record<string, unknown> | null) ?? null,
                          )
                        : incoming;

                    // ── Rolling-window gain caps (finding 6) ──────────────────
                    // Track ryo / stat / xp gain over the last 60 seconds for
                    // this account. If a save would push cumulative gains over
                    // the threshold, reject with 429. Clan saves skipped.
                    if (existing && !isClanSave && identityName) {
                        const exChar = (existing as Record<string, unknown>).character as Record<string, unknown> | undefined;
                        const inChar = (safeIncoming as Record<string, unknown>).character as Record<string, unknown> | undefined;
                        if (exChar && inChar) {
                            const exRyo = Math.max(0, Number(exChar.ryo ?? 0));
                            const inRyo = Math.max(0, Number(inChar.ryo ?? 0));
                            const ryoDelta = Math.max(0, inRyo - exRyo);
                            const exXp = Math.max(0, Number(exChar.xp ?? exChar.experience ?? 0));
                            const inXp = Math.max(0, Number(inChar.xp ?? inChar.experience ?? 0));
                            const xpDelta = Math.max(0, inXp - exXp);
                            const exStats = (exChar.stats ?? {}) as Record<string, number>;
                            const inStats = (inChar.stats ?? {}) as Record<string, number>;
                            const statDelta: Record<string, number> = {};
                            for (const k of Object.keys(inStats)) {
                                const ex = Number(exStats[k] ?? 0);
                                const inv = Number(inStats[k] ?? 0);
                                const d = Math.max(0, inv - ex);
                                if (d > 0) statDelta[k] = d;
                            }

                            const win = (await readGainsWindow(identityName)) ?? freshWindow();
                            const ageMs = Date.now() - win.startedAt;
                            const cur = (ageMs > GAIN_WINDOW_MS) ? freshWindow() : win;

                            const nextRyo = cur.ryo + ryoDelta;
                            const nextXp = cur.xp + xpDelta;
                            const nextStat: Record<string, number> = { ...cur.stat };
                            for (const [k, d] of Object.entries(statDelta)) nextStat[k] = (nextStat[k] ?? 0) + d;

                            if (nextRyo > MAX_RYO_PER_MINUTE) {
                                return res.status(429).json({
                                    error: `Ryo gain rate-limited (over ${MAX_RYO_PER_MINUTE} / 60s).`,
                                });
                            }
                            if (nextXp > MAX_XP_PER_MINUTE) {
                                return res.status(429).json({
                                    error: `XP gain rate-limited (over ${MAX_XP_PER_MINUTE} / 60s).`,
                                });
                            }
                            for (const [k, total] of Object.entries(nextStat)) {
                                if (total > MAX_STAT_PER_MINUTE) {
                                    return res.status(429).json({
                                        error: `Stat ${k} gain rate-limited (over ${MAX_STAT_PER_MINUTE} / 60s).`,
                                    });
                                }
                            }

                            // Allowed — persist the updated window.
                            await writeGainsWindow(identityName, { startedAt: cur.startedAt, ryo: nextRyo, stat: nextStat, xp: nextXp });
                        }
                    }

                    const payload = existing ? mergePreservingImages(safeIncoming, existing) : safeIncoming;

                    const char = (incoming as Record<string, unknown>)?.character as Record<string, unknown> | undefined;
                    const displayName: string = (char?.name as string) || name;
                    const registryEntry = {
                        name: displayName,
                        level: (char?.level as number) ?? 1,
                        village: (char?.village as string) ?? '',
                        specialty: (char?.specialty as string) ?? '',
                        lastSeen: Date.now(),
                    };

                    await Promise.all([
                        kv.set(key, payload),
                        kv.hset(REGISTRY_KEY, { [name]: registryEntry }),
                    ]);
                    return res.status(200).end();
                } finally {
                    if (!isClanSave) {
                        await kv.del(writeLockKey).catch(() => undefined);
                    }
                }
            }

            // Admin save path — lock first, then read + write, then signal reload.
            await kv.set(adminLockKey, 1, { ex: 300 });
            const existing = await kv.get(key);
            const payload = existing ? mergePreservingImages(incoming, existing) : incoming;

            const char = (incoming as Record<string, unknown>)?.character as Record<string, unknown> | undefined;
            const displayName: string = (char?.name as string) || name;
            const registryEntry = {
                name: displayName,
                level: (char?.level as number) ?? 1,
                village: (char?.village as string) ?? '',
                specialty: (char?.specialty as string) ?? '',
                lastSeen: Date.now(),
            };

            await Promise.all([
                kv.set(key, payload),
                kv.hset(REGISTRY_KEY, { [name]: registryEntry }),
            ]);
            // Set reset-signal after the new save is committed so the client reloads that exact version.
            await kv.set(resetSignalKey, 1, { ex: 300 });
            return res.status(200).end();
        } catch (err) {
            console.error('[save POST]', err);
            return res.status(500).json({ error: 'Internal server error.' });
        }
    }

    if (req.method === 'DELETE') {
        try {
            const adminAuth = isAdmin(req);
            if (!adminAuth) {
                // Player must auth via headers; clan saves allow any logged-in
                // player (deletes are admin-gated UI in practice).
                const identity = await authedPlayerOrAdmin(req, name);
                if (!identity) return res.status(401).json({ error: 'Authentication required.' });
                if (!identity.admin && !isClanSave && identity.name !== name) {
                    // Backwards-compat: legacy body-supplied password also accepted.
                    const playerPw = req.headers['x-player-password'] as string | undefined;
                    const authRecord = await kv.get(`auth:${name.toLowerCase()}`);
                    if (authRecord) {
                        if (!playerPw || !(await verifyPlayerPassword(name, playerPw))) {
                            return res.status(403).json({ error: 'Cannot delete another player\'s save.' });
                        }
                    }
                }
            }
            const lowered = name.toLowerCase();
            const adminLockKey = `admin-lock:${lowered}`;
            await kv.set(adminLockKey, 1, { ex: 300 });
            await Promise.all([
                kv.del(key),
                kv.hdel(REGISTRY_KEY, name),
                // Signal the player's client to reload on next heartbeat (5-min TTL)
                kv.set(`reset-signal:${lowered}`, 1, { ex: 300 }),
            ]);
            return res.status(200).json({ ok: true });
        } catch (err) {
            console.error('[save DELETE]', err);
            return res.status(500).json({ error: 'Internal server error.' });
        }
    }

    return res.status(405).end();
}
