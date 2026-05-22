"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
const _storage_js_1 = require("../_storage.js");
const _utils_js_1 = require("../_utils.js");
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
        const nameLower = name.toLowerCase().trim();
        const raw = await _storage_js_1.kv.get('ranked-queue') ?? [];
        const updated = raw.filter((e) => e.name.toLowerCase() !== nameLower);
        await _storage_js_1.kv.set('ranked-queue', updated, { ex: 600 });
        return res.status(200).json({ ok: true });
    }
    catch (err) {
        return res.status(500).json({ error: String(err) });
    }
}
