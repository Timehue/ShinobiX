"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
const _storage_js_1 = require("../_storage.js");
const _utils_js_1 = require("../_utils.js");
const _auth_js_1 = require("../_auth.js");
async function handler(req, res) {
    (0, _utils_js_1.cors)(res, req);
    if (req.method === 'OPTIONS')
        return res.status(200).end();
    if (req.method !== 'POST')
        return res.status(405).end();
    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        const { name } = body;
        if (!name)
            return res.status(400).json({ error: 'Missing name.' });
        const identity = await (0, _auth_js_1.authedPlayerOrAdmin)(req, name);
        if (!identity)
            return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== name.toLowerCase().trim()) {
            return res.status(403).json({ error: 'Cannot leave queue as another player.' });
        }
        const nameLower = name.toLowerCase().trim();
        const raw = await _storage_js_1.kv.get('ranked-queue') ?? [];
        const updated = raw.filter((e) => e.name.toLowerCase() !== nameLower);
        await _storage_js_1.kv.set('ranked-queue', updated, { ex: 600 });
        return res.status(200).json({ ok: true });
    }
    catch (err) {
        console.error('[ranked-queue/leave]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
