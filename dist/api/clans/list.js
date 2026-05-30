"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
const _storage_js_1 = require("../_storage.js");
const _utils_js_1 = require("../_utils.js");
async function handler(req, res) {
    (0, _utils_js_1.cors)(res, req);
    if (req.method === 'OPTIONS')
        return res.status(200).end();
    if (req.method !== 'GET')
        return res.status(405).end();
    try {
        // Clans are stored with key pattern clan:{id}
        const keys = await _storage_js_1.kv.keys('clan:*');
        // 30s edge cache + 60s SWR. The public clan list changes when a
        // clan is created/disbanded/edited — minute-scale latency is
        // fine, and the underlying mget is expensive (one row per clan).
        res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=60');
        if (!keys.length)
            return res.status(200).json([]);
        const clans = await _storage_js_1.kv.mget(...keys);
        return res.status(200).json(clans.filter(Boolean));
    }
    catch (err) {
        console.error('[clans/list]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
