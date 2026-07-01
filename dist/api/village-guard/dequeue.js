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
        const parsed = (0, _utils_js_1.parseJsonBody)(req.body);
        if (!parsed.ok)
            return res.status(400).json({ error: parsed.error });
        const { name } = parsed.body;
        if (!name)
            return res.status(400).json({ error: 'Missing name.' });
        const identity = await (0, _auth_js_1.authedPlayerOrAdmin)(req, name);
        if (!identity)
            return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== (0, _utils_js_1.safeName)(name)) {
            return res.status(403).json({ error: 'Cannot dequeue another player.' });
        }
        await _storage_js_1.kv.del(`guard:${(0, _utils_js_1.safeName)(name)}`);
        return res.status(200).json({ ok: true });
    }
    catch (err) {
        console.error('[village-guard/dequeue]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
