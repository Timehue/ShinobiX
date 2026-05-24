import type { VercelRequest, VercelResponse } from '@vercel/node';
import { kv } from '../_storage.js';
import { safeName, mergePreservingImages, cors } from '../_utils.js';
import { verifyPlayerPassword } from '../player-auth.js';
import { authedPlayerOrAdmin, isAdmin } from '../_auth.js';

// Fields stripped from character objects when a non-owner reads another player's save.
// Prevents ryo farming (reading other players' wallets) and inventory snooping.
const PRIVATE_CHAR_FIELDS = [
    'ryo', 'bankedRyo', 'inventory', 'missions', 'missionLog',
    'completedMissions', 'activeMissions', 'questLog', 'bankLog',
] as const;

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

function sanitizeCharacterSave(
    incoming: Record<string, unknown>,
    existing: Record<string, unknown>,
): Record<string, unknown> {
    const inChar = incoming.character as Record<string, unknown> | undefined;
    const exChar = existing.character as Record<string, unknown> | undefined;
    // If either side is missing a character object we can't diff — return as-is
    // and let the existing merge logic handle it.
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
        // Owners and admins get the full save. Other players (e.g. loading a
        // PvP opponent) get character data with private economy fields removed.
        const isOwner = identity.admin || (isClanSave ? false : identity.name === name.toLowerCase().trim());
        const payload = isOwner ? data : stripPrivateFields(data);
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
            if (isAdminSave) {
                if (!isAdmin(req)) {
                    return res.status(401).json({ error: 'Admin authentication required.' });
                }
            } else {
                // Non-admin saves: player can save their own; any logged-in
                // player can write clan saves (shared per-clan record).
                const identity = await authedPlayerOrAdmin(req, name);
                if (!identity) return res.status(401).json({ error: 'Authentication required.' });
                if (!identity.admin && !isClanSave && identity.name !== name) {
                    return res.status(403).json({ error: 'Cannot save another player.' });
                }
            }

            // If a reset-signal is pending (admin edit in-flight) and this is NOT the admin save,
            // silently drop the client auto-save so it can't overwrite admin changes.
            // Speculatively fetch the existing save in parallel with the signal checks —
            // saves one round-trip on every auto-save (the common path).
            const incoming = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
            if (!isAdminSave) {
                const [pendingSignal, adminLock, existing] = await Promise.all([
                    kv.get(resetSignalKey),
                    kv.get(adminLockKey),
                    kv.get(key),
                ]);
                if (pendingSignal || adminLock) return res.status(200).end();
                // Sanitize before merge: caps per-save gains to prevent exploit spikes.
                // Clan saves are collaborative (no single "owner" baseline), so we skip
                // sanitization for them — they're already admin-locked in the UI.
                const safeIncoming = (existing && !isClanSave)
                    ? sanitizeCharacterSave(
                        incoming as Record<string, unknown>,
                        existing as Record<string, unknown>,
                      )
                    : incoming;
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
