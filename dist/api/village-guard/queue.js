"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
const _storage_js_1 = require("../_storage.js");
const _utils_js_1 = require("../_utils.js");
const _auth_js_1 = require("../_auth.js");
const _ratelimit_js_1 = require("../_ratelimit.js");
async function handler(req, res) {
    (0, _utils_js_1.cors)(res, req);
    if (req.method === 'OPTIONS')
        return res.status(200).end();
    if (req.method !== 'POST')
        return res.status(405).end();
    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        const { name, village } = body;
        if (!name || !village)
            return res.status(400).json({ error: 'Missing name or village.' });
        const identity = await (0, _auth_js_1.authedPlayerOrAdmin)(req, name);
        if (!identity)
            return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== name.toLowerCase().trim()) {
            return res.status(403).json({ error: 'Cannot queue as another player.' });
        }
        // Per-actor rate limit. The legit flow is "queue once when you go
        // AFK as a guard" — 6/min is comfortable for re-queuing across
        // disconnects but kills any KV-churn attack that hammers
        // guard:<name> writes (each refreshes the 5min TTL).
        const rlName = identity.admin ? undefined : identity.name;
        if (!identity.admin && !(0, _ratelimit_js_1.enforceRateLimit)(req, res, 'village-guard-queue', 6, 60_000, rlName))
            return;
        // Derive level (and verify village) from the server-side save.
        let serverLevel = 1;
        let serverVillage = village;
        if (!identity.admin) {
            try {
                const save = await _storage_js_1.kv.get(`save:${identity.name}`);
                const char = (save?.character ?? null);
                if (char) {
                    if (typeof char.level === 'number')
                        serverLevel = char.level;
                    if (typeof char.village === 'string' && char.village)
                        serverVillage = char.village;
                }
            }
            catch {
                // best-effort
            }
            // Only allow guarding the village your save says you belong to.
            if (serverVillage !== village) {
                return res.status(403).json({ error: 'Cannot guard a village other than your own.' });
            }
        }
        const normalizedName = name.toLowerCase().trim();
        await _storage_js_1.kv.set(`guard:${normalizedName}`, { name, village: serverVillage, level: serverLevel, lastSeen: Date.now() }, { ex: 300 });
        return res.status(200).json({ ok: true });
    }
    catch (err) {
        console.error('[village-guard/queue]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
