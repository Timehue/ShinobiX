"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
const _utils_js_1 = require("../_utils.js");
const _floor_catalog_js_1 = require("./_floor-catalog.js");
/*
 * GET /api/towers/floors — the public floor-catalog metadata for the lobby picker.
 *
 * Display-only fields (no sealed rewards / enemy stats). The catalog is the single source
 * of truth; the client renders the picker from this rather than a duplicated mirror.
 */
async function handler(req, res) {
    (0, _utils_js_1.cors)(res, req);
    if (req.method === 'OPTIONS')
        return res.status(200).end();
    if (req.method !== 'GET')
        return res.status(405).end();
    res.setHeader('Cache-Control', 's-maxage=300');
    return res.status(200).json({
        floors: _floor_catalog_js_1.FLOOR_CATALOG.map(f => ({
            id: f.id,
            name: f.name,
            biome: f.biome,
            objective: f.objective,
            roundBudget: f.roundBudget,
            isBoss: !!f.boss,
            milestone: f.firstClearReward.milestone ?? null,
            map: { width: f.map.width, height: f.map.height },
        })),
    });
}
