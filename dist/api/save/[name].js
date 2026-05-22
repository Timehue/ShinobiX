"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
const _storage_js_1 = require("../_storage.js");
const _utils_js_1 = require("../_utils.js");
const player_auth_js_1 = require("../player-auth.js");
const REGISTRY_KEY = 'player:registry';
async function handler(req, res) {
    (0, _utils_js_1.cors)(res);
    if (req.method === 'OPTIONS')
        return res.status(200).end();
    const name = (0, _utils_js_1.safeName)(String(req.query.name ?? ''));
    if (!name)
        return res.status(400).json({ error: 'Invalid name.' });
    const key = `save:${name}`;
    if (req.method === 'GET') {
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
                await Promise.all([
                    _storage_js_1.kv.del(resetSignalKey),
                    _storage_js_1.kv.del(adminLockKey),
                ]);
                return res.status(200).json({ ok: true });
            }
            const isAdminSave = req.query.signal === '1';
            // Admin-flagged writes require the admin password to prevent any client
            // from force-reloading a player with arbitrary data.
            if (isAdminSave) {
                const adminPassword = process.env.ADMIN_PASSWORD;
                const providedPw = req.headers['x-admin-password'];
                if (!adminPassword || providedPw !== adminPassword) {
                    return res.status(401).json({ error: 'Admin authentication required.' });
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
            const adminPassword = process.env.ADMIN_PASSWORD;
            const adminPw = req.headers['x-admin-password'];
            const playerPw = req.headers['x-player-password'];
            const isAdmin = adminPassword && adminPw === adminPassword;
            if (!isAdmin) {
                // Allow player to delete their own save by providing their own password.
                if (!playerPw)
                    return res.status(401).json({ error: 'Authentication required.' });
                const authRecord = await _storage_js_1.kv.get(`auth:${name.toLowerCase()}`);
                if (authRecord) {
                    // Server-side password exists — must verify
                    const valid = await (0, player_auth_js_1.verifyPlayerPassword)(name, playerPw);
                    if (!valid)
                        return res.status(401).json({ error: 'Incorrect password.' });
                }
                // Legacy account (no server auth record) — allow delete; player is already
                // authenticated client-side to reach this button.
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
