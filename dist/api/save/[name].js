"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
const _storage_js_1 = require("../_storage.js");
const _utils_js_1 = require("../_utils.js");
const player_auth_js_1 = require("../player-auth.js");
const _auth_js_1 = require("../_auth.js");
const REGISTRY_KEY = 'player:registry';
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
        //
        // TODO: strip sensitive fields (ryo, inventory, etc.) when the reader
        // isn't the owner. For now just require any valid login.
        const identity = await (0, _auth_js_1.authedPlayerOrAdmin)(req, name);
        if (!identity)
            return res.status(401).json({ error: 'Authentication required.' });
        const data = await _storage_js_1.kv.get(key);
        if (data === null)
            return res.status(404).end();
        return res.status(200).json(data);
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
                    _storage_js_1.kv.hset(REGISTRY_KEY, { [name]: JSON.stringify(registryEntry) }),
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
                _storage_js_1.kv.hset(REGISTRY_KEY, { [name]: JSON.stringify(registryEntry) }),
            ]);
            // Set reset-signal after the new save is committed so the client reloads that exact version.
            await _storage_js_1.kv.set(resetSignalKey, 1, { ex: 300 });
            return res.status(200).end();
        }
        catch (err) {
            return res.status(500).json({ error: String(err) });
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
            return res.status(500).json({ error: String(err) });
        }
    }
    return res.status(405).end();
}
