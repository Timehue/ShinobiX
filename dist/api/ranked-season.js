"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
const _storage_js_1 = require("./_storage.js");
const _utils_js_1 = require("./_utils.js");
const _ranked_season_js_1 = require("./cron/_ranked-season.js");
async function handler(req, res) {
    (0, _utils_js_1.cors)(res, req);
    if (req.method === 'OPTIONS')
        return res.status(200).end();
    if (req.method !== 'GET')
        return res.status(405).end();
    const current = await _storage_js_1.kv.get(_ranked_season_js_1.SEASON_CURRENT_KEY);
    // Last season = current.id - 1 (none before season 2).
    const lastId = current && current.id > 1 ? current.id - 1 : 0;
    const lastSeason = lastId ? await _storage_js_1.kv.get(`${_ranked_season_js_1.SEASON_ARCHIVE_PREFIX}${lastId}`).catch(() => null) : null;
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=60');
    return res.status(200).json({ current: current ?? null, lastSeason: lastSeason ?? null });
}
