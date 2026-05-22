"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
const _storage_js_1 = require("../_storage.js");
const _utils_js_1 = require("../_utils.js");
const _auth_js_1 = require("../_auth.js");
async function handler(req, res) {
    (0, _utils_js_1.cors)(res);
    if (req.method === 'OPTIONS')
        return res.status(200).end();
    if (req.method !== 'POST')
        return res.status(405).end();
    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        const { name } = body;
        if (!name)
            return res.status(400).json({ error: 'Missing name.' });
        // Can only clear your own pending attacker.
        const identity = await (0, _auth_js_1.authedPlayerOrAdmin)(req, name);
        if (!identity)
            return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== name.toLowerCase().trim()) {
            return res.status(403).json({ error: 'Cannot clear another player.' });
        }
        const key = `presence:${name}`;
        const entry = await _storage_js_1.kv.get(key);
        if (entry)
            await _storage_js_1.kv.set(key, { ...entry, pendingAttacker: null }, { ex: 60 });
        return res.status(200).json({ ok: true });
    }
    catch (err) {
        console.error('[clear-attack]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
