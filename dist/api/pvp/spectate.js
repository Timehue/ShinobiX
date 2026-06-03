"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
const _storage_js_1 = require("../_storage.js");
const _utils_js_1 = require("../_utils.js");
const _auth_js_1 = require("../_auth.js");
const KV_TTL_SECONDS = 2 * 60 * 60; // 2-hour TTL
const STALE_MS = 30 * 1000; // Remove spectators who haven't pinged in 30s
function specKey(battleId) {
    return `pvp:spectators:${battleId}`;
}
async function handler(req, res) {
    (0, _utils_js_1.cors)(res, req);
    if (req.method === 'OPTIONS')
        return res.status(200).end();
    const battleId = typeof req.query.id === 'string' ? req.query.id.trim() : '';
    if (!battleId)
        return res.status(400).json({ error: 'Missing battle id.' });
    const key = specKey(battleId);
    if (req.method === 'GET') {
        // Auth gate: previously anyone could poll any battleId and harvest
        // the list of lowercase player names currently watching it — a
        // useful presence-tracking signal for stalkers / mods circumventing
        // the moderation tooling. Logged-in players only.
        const identity = await (0, _auth_js_1.authedPlayerOrAdmin)(req);
        if (!identity)
            return res.status(401).json({ error: 'Authentication required.' });
        const spectators = await _storage_js_1.kv.get(key) ?? [];
        const active = spectators.filter(s => Date.now() - s.joinedAt < STALE_MS);
        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).json(active);
    }
    if (req.method === 'POST') {
        try {
            const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
            const { name, action } = body;
            if (!name || !action)
                return res.status(400).json({ error: 'Missing name or action.' });
            // Require auth, and the body's `name` must match the authed identity.
            const identity = await (0, _auth_js_1.authedPlayerOrAdmin)(req, name);
            if (!identity)
                return res.status(401).json({ error: 'Authentication required.' });
            if (!identity.admin && identity.name !== (0, _utils_js_1.safeName)(name)) {
                return res.status(403).json({ error: 'Cannot spectate as another player.' });
            }
            const existing = await _storage_js_1.kv.get(key) ?? [];
            // Remove stale + the named spectator (for both join and leave)
            const filtered = existing.filter(s => Date.now() - s.joinedAt < STALE_MS && s.name !== (0, _utils_js_1.safeName)(name));
            if (action === 'join') {
                filtered.push({ name: (0, _utils_js_1.safeName)(name), joinedAt: Date.now() });
            }
            await _storage_js_1.kv.set(key, filtered, { ex: KV_TTL_SECONDS });
            return res.status(200).json(filtered);
        }
        catch (err) {
            console.error('[pvp/spectate]', err);
            return res.status(500).json({ error: 'Internal server error.' });
        }
    }
    return res.status(405).end();
}
