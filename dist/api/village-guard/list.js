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
        const { village } = body;
        if (!village)
            return res.status(400).json({ error: 'Missing village.' });
        const keys = await _storage_js_1.kv.keys('guard:*');
        const guards = (await _storage_js_1.kv.mget(...keys))
            .filter((g) => !!g && g.village === village)
            .map(({ name, level, village: v }) => ({ name, level, village: v }));
        return res.status(200).json(guards);
    }
    catch (err) {
        console.error('[village-guard/list]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
