"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
const _storage_js_1 = require("../../_storage.js");
const _utils_js_1 = require("../../_utils.js");
const _auth_js_1 = require("../../_auth.js");
const _ratelimit_js_1 = require("../../_ratelimit.js");
const _storage_js_2 = require("./_storage.js");
async function handler(req, res) {
    (0, _utils_js_1.cors)(res, req);
    if (req.method === 'OPTIONS')
        return res.status(200).end();
    if (req.method !== 'POST')
        return res.status(405).end();
    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        const playerName = (0, _utils_js_1.safeName)(String(body.playerName ?? ''));
        if (!playerName)
            return res.status(400).json({ error: 'Invalid player name.' });
        const identity = await (0, _auth_js_1.authedPlayerOrAdmin)(req, playerName);
        if (!identity)
            return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) {
            return res.status(403).json({ error: 'Can only cancel your own offer.' });
        }
        if (!identity.admin && !(await (0, _ratelimit_js_1.enforceRateLimitKv)(req, res, 'pet-escort-cancel', 15, 60_000, identity.name)))
            return;
        const record = await _storage_js_1.kv.get(`save:${playerName}`);
        const char = record?.character;
        if (!char)
            return res.status(404).json({ error: 'Character not found.' });
        const clanName = typeof char.clan === 'string' ? char.clan : '';
        if (!clanName)
            return res.status(400).json({ error: 'No clan to cancel from.' });
        await (0, _storage_js_2.cancelEscort)(clanName, playerName);
        return res.status(200).json({ ok: true });
    }
    catch (err) {
        console.error('[clan/pet-escort/cancel]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
