"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
const _storage_js_1 = require("../_storage.js");
const _utils_js_1 = require("../_utils.js");
const player_auth_js_1 = require("../player-auth.js");
const _auth_js_1 = require("../_auth.js");
// Fields stripped from character objects when a non-owner reads another player's save.
// Prevents ryo farming (reading other players' wallets) and inventory snooping.
const PRIVATE_CHAR_FIELDS = [
    'ryo', 'bankedRyo', 'inventory', 'missions', 'missionLog',
    'completedMissions', 'activeMissions', 'questLog', 'bankLog',
];
function stripPrivateFields(data) {
    const char = data.character;
    if (!char || typeof char !== 'object')
        return data;
    const sanitized = { ...char };
    for (const field of PRIVATE_CHAR_FIELDS)
        delete sanitized[field];
    return { ...data, character: sanitized };
}
const REGISTRY_KEY = 'player:registry';
// ─── Save sanitization ────────────────────────────────────────────────────────
// Applied to every non-admin player save to prevent client-side economy cheating.
// Caps per-save *gains* rather than imposing hard ceilings, so legitimate large
// values (high-level players with lots of ryo) are preserved while exploit spikes
// (editing localStorage / fetch body) are clamped.
const MAX_RYO_GAIN = 1_000_000; // max ryo a player can earn per save cycle
const CURRENCY_CAPS = {
    fateShards: 50,
    boneCharms: 50,
    auraStones: 50,
    auraDust: 100,
    mythicSeals: 50,
    honorSeals: 200,
};
const MAX_STAT_GAIN = 500; // per individual stat per save cycle
const MAX_LEVEL_GAIN = 5; // levels that can be gained between saves
const LEVEL_CAP = 100;
function sanitizeCharacterSave(incoming, existing) {
    const inChar = incoming.character;
    const exChar = existing.character;
    // If either side is missing a character object we can't diff — return as-is
    // and let the existing merge logic handle it.
    if (!inChar || typeof inChar !== 'object')
        return incoming;
    if (!exChar || typeof exChar !== 'object')
        return incoming;
    const char = { ...inChar };
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
    const inStats = char.stats;
    const exStats = exChar.stats;
    if (inStats && typeof inStats === 'object' && exStats && typeof exStats === 'object') {
        const s = { ...inStats };
        for (const k of Object.keys(s)) {
            const exV = Math.max(0, Number(exStats[k] ?? 0));
            s[k] = Math.min(Math.max(0, Number(s[k] ?? 0)), exV + MAX_STAT_GAIN);
        }
        char.stats = s;
    }
    // HP / chakra / stamina must not exceed their own max fields.
    if (Number(char.hp ?? 0) > Number(char.maxHp ?? char.hp))
        char.hp = char.maxHp;
    if (Number(char.chakra ?? 0) > Number(char.maxChakra ?? char.chakra))
        char.chakra = char.maxChakra;
    if (Number(char.stamina ?? 0) > Number(char.maxStamina ?? char.stamina))
        char.stamina = char.maxStamina;
    return { ...incoming, character: char };
}
async function handler(req, res) {
    (0, _utils_js_1.cors)(res);
    if (req.method === 'OPTIONS')
        return res.status(200).end();
    const name = (0, _utils_js_1.safeName)(String(req.query.name ?? ''));
    if (!name)
        return res.status(400).json({ error: 'Invalid name.' });
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
        const identity = await (0, _auth_js_1.authedPlayerOrAdmin)(req, name);
        if (!identity)
            return res.status(401).json({ error: 'Authentication required.' });
        const data = await _storage_js_1.kv.get(key);
        if (data === null)
            return res.status(404).end();
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
                const ackIdentity = await (0, _auth_js_1.authedPlayerOrAdmin)(req, name);
                if (!ackIdentity)
                    return res.status(401).json({ error: 'Authentication required.' });
                if (!ackIdentity.admin && !isClanSave && ackIdentity.name !== name) {
                    return res.status(403).json({ error: 'Cannot ack another player.' });
                }
                await Promise.all([
                    _storage_js_1.kv.del(resetSignalKey),
                    _storage_js_1.kv.del(adminLockKey),
                ]);
                return res.status(200).json({ ok: true });
            }
            const isAdminSave = req.query.signal === '1';
            // Admin-flagged writes require admin auth (constant-time compare in isAdmin).
            if (isAdminSave) {
                if (!(0, _auth_js_1.isAdmin)(req)) {
                    return res.status(401).json({ error: 'Admin authentication required.' });
                }
            }
            else {
                // Non-admin saves: player can save their own; any logged-in
                // player can write clan saves (shared per-clan record).
                const identity = await (0, _auth_js_1.authedPlayerOrAdmin)(req, name);
                if (!identity)
                    return res.status(401).json({ error: 'Authentication required.' });
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
                    _storage_js_1.kv.get(resetSignalKey),
                    _storage_js_1.kv.get(adminLockKey),
                    _storage_js_1.kv.get(key),
                ]);
                if (pendingSignal || adminLock)
                    return res.status(200).end();
                // Sanitize before merge: caps per-save gains to prevent exploit spikes.
                // Clan saves are collaborative (no single "owner" baseline), so we skip
                // sanitization for them — they're already admin-locked in the UI.
                const safeIncoming = (existing && !isClanSave)
                    ? sanitizeCharacterSave(incoming, existing)
                    : incoming;
                const payload = existing ? (0, _utils_js_1.mergePreservingImages)(safeIncoming, existing) : safeIncoming;
                const char = incoming?.character;
                const displayName = char?.name || name;
                const registryEntry = {
                    name: displayName,
                    level: char?.level ?? 1,
                    village: char?.village ?? '',
                    specialty: char?.specialty ?? '',
                    lastSeen: Date.now(),
                };
                await Promise.all([
                    _storage_js_1.kv.set(key, payload),
                    _storage_js_1.kv.hset(REGISTRY_KEY, { [name]: registryEntry }),
                ]);
                return res.status(200).end();
            }
            // Admin save path — lock first, then read + write, then signal reload.
            await _storage_js_1.kv.set(adminLockKey, 1, { ex: 300 });
            const existing = await _storage_js_1.kv.get(key);
            const payload = existing ? (0, _utils_js_1.mergePreservingImages)(incoming, existing) : incoming;
            const char = incoming?.character;
            const displayName = char?.name || name;
            const registryEntry = {
                name: displayName,
                level: char?.level ?? 1,
                village: char?.village ?? '',
                specialty: char?.specialty ?? '',
                lastSeen: Date.now(),
            };
            await Promise.all([
                _storage_js_1.kv.set(key, payload),
                _storage_js_1.kv.hset(REGISTRY_KEY, { [name]: registryEntry }),
            ]);
            // Set reset-signal after the new save is committed so the client reloads that exact version.
            await _storage_js_1.kv.set(resetSignalKey, 1, { ex: 300 });
            return res.status(200).end();
        }
        catch (err) {
            console.error('[save POST]', err);
            return res.status(500).json({ error: 'Internal server error.' });
        }
    }
    if (req.method === 'DELETE') {
        try {
            const adminAuth = (0, _auth_js_1.isAdmin)(req);
            if (!adminAuth) {
                // Player must auth via headers; clan saves allow any logged-in
                // player (deletes are admin-gated UI in practice).
                const identity = await (0, _auth_js_1.authedPlayerOrAdmin)(req, name);
                if (!identity)
                    return res.status(401).json({ error: 'Authentication required.' });
                if (!identity.admin && !isClanSave && identity.name !== name) {
                    // Backwards-compat: legacy body-supplied password also accepted.
                    const playerPw = req.headers['x-player-password'];
                    const authRecord = await _storage_js_1.kv.get(`auth:${name.toLowerCase()}`);
                    if (authRecord) {
                        if (!playerPw || !(await (0, player_auth_js_1.verifyPlayerPassword)(name, playerPw))) {
                            return res.status(403).json({ error: 'Cannot delete another player\'s save.' });
                        }
                    }
                }
            }
            const lowered = name.toLowerCase();
            const adminLockKey = `admin-lock:${lowered}`;
            await _storage_js_1.kv.set(adminLockKey, 1, { ex: 300 });
            await Promise.all([
                _storage_js_1.kv.del(key),
                _storage_js_1.kv.hdel(REGISTRY_KEY, name),
                // Signal the player's client to reload on next heartbeat (5-min TTL)
                _storage_js_1.kv.set(`reset-signal:${lowered}`, 1, { ex: 300 }),
            ]);
            return res.status(200).json({ ok: true });
        }
        catch (err) {
            console.error('[save DELETE]', err);
            return res.status(500).json({ error: 'Internal server error.' });
        }
    }
    return res.status(405).end();
}
