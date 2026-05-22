"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
const _storage_js_1 = require("../_storage.js");
const _utils_js_1 = require("../_utils.js");
async function handler(req, res) {
    (0, _utils_js_1.cors)(res);
    if (req.method === 'OPTIONS')
        return res.status(200).end();
    if (req.method !== 'GET')
        return res.status(405).end();
    try {
        // Clans are stored with key pattern clan:{id}
        const keys = await _storage_js_1.kv.keys('clan:*');
        if (!keys.length)
            return res.status(200).json([]);
        const clans = await _storage_js_1.kv.mget(...keys);
        return res.status(200).json(clans.filter(Boolean));
    }
    catch (err) {
        return res.status(500).json({ error: String(err) });
    }
}
