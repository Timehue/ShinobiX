"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
const node_crypto_1 = require("node:crypto");
const _storage_js_1 = require("../_storage.js");
const _utils_js_1 = require("../_utils.js");
const _auth_js_1 = require("../_auth.js");
const _ratelimit_js_1 = require("../_ratelimit.js");
const _encounter_js_1 = require("./_encounter.js");
async function handler(req, res) {
    (0, _utils_js_1.cors)(res, req);
    if (req.method === 'OPTIONS')
        return res.status(200).end();
    if (req.method !== 'POST')
        return res.status(405).end();
    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {});
        const playerName = (0, _utils_js_1.safeName)(String(body.playerName ?? ''));
        const identity = playerName ? await (0, _auth_js_1.authedPlayerOrAdmin)(req, playerName) : null;
        if (!identity)
            return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName)
            return res.status(403).json({ error: 'Not your encounter.' });
        if (!identity.admin && !(await (0, _ratelimit_js_1.enforceRateLimitKv)(req, res, 'pet-encounter-start', 180, 60_000, identity.name)))
            return;
        const day = new Date().toISOString().slice(0, 10);
        const count = await _storage_js_1.kv.incr(`pet-encounter-attempt:${playerName}:${day}`, { ex: 26 * 60 * 60 });
        if (!identity.admin && count > _encounter_js_1.DAILY_WILD_ENCOUNTER_ATTEMPTS)
            return res.status(429).json({ error: 'Daily exploration limit reached.' });
        const pet = (0, _encounter_js_1.rollWildPet)(() => (0, node_crypto_1.randomInt)(1_000_000_000) / 1_000_000_000);
        if (!pet)
            return res.status(200).json({ ok: true, pet: null });
        const token = (0, node_crypto_1.randomUUID)().replace(/-/g, '');
        await _storage_js_1.kv.set(`pet-encounter:${playerName}:${token}`, { playerName, pet, mintedAt: Date.now() }, { ex: 20 * 60 });
        return res.status(200).json({ ok: true, token, pet });
    }
    catch (error) {
        console.error('[pet/encounter-start]', error);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
