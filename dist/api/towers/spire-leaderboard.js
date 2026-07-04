"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
const _utils_js_1 = require("../_utils.js");
const _storage_js_1 = require("../_storage.js");
const _weekly_board_js_1 = require("../missions/_weekly-board.js");
const _tower_store_js_1 = require("./_tower-store.js");
/*
 * GET /api/towers/spire-leaderboard[?top=N]  →  { weekKey, total, leaderboard }
 *
 * Public, read-only weekly Endless Spire board. Reads the MAINTAINED board (upserted by
 * settleSpireForMember on every clear — best tier per player this reset-week), so this is a
 * single KV read, never a save scan. Only the display-safe projection is returned
 * (name / tier / village / level — the same public surface the roster already exposes).
 */
async function handler(req, res) {
    (0, _utils_js_1.cors)(res, req);
    if (req.method === 'OPTIONS')
        return res.status(200).end();
    if (req.method !== 'GET')
        return res.status(405).json({ error: 'Method not allowed.' });
    try {
        const wk = (0, _weekly_board_js_1.weekKey)(Date.now());
        const topRaw = Number(req.query.top);
        const limit = Number.isInteger(topRaw) && topRaw > 0 && topRaw <= 100 ? topRaw : 25;
        const list = (await _storage_js_1.kv.get((0, _tower_store_js_1.spireLbKey)(wk))) ?? [];
        const arr = Array.isArray(list) ? list : [];
        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).json({
            weekKey: wk,
            total: arr.length,
            leaderboard: arr.slice(0, limit).map((e, i) => ({
                rank: i + 1, name: e.name, tier: e.tier, village: e.village, level: e.level,
            })),
        });
    }
    catch (err) {
        console.error('[towers/spire-leaderboard]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
