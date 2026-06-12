"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
const _utils_js_1 = require("../_utils.js");
const _auth_js_1 = require("../_auth.js");
const _ratelimit_js_1 = require("../_ratelimit.js");
const _asset_registry_js_1 = require("../_asset-registry.js");
// Admin-only asset-registry report (Priority 6).
//
// Returns the metadata layer (`asset:meta:*`) the image system never had:
// per-asset type/format/size/hash/createdBy/hidden, a category histogram, and
// server-computed duplicates (assets sharing a content hash). The admin panel
// cross-references this against the in-memory catalogs + the existing
// `/api/images?cat=X&ids=1` manifest to surface missing / dead / unused /
// missing-metadata assets client-side. Read-only; mutates nothing.
//
//   GET /api/admin/asset-report   (x-admin-password header)
//   → 200 { total, byCategory, duplicates, hidden, assets }
async function handler(req, res) {
    (0, _utils_js_1.cors)(res, req);
    if (req.method === 'OPTIONS')
        return res.status(200).end();
    if (req.method !== 'GET' && req.method !== 'POST')
        return res.status(405).end();
    if (!(0, _auth_js_1.isAdmin)(req))
        return res.status(403).json({ error: 'Admin access required.' });
    if (!(0, _ratelimit_js_1.enforceRateLimit)(req, res, 'admin-asset-report', 30, 60_000))
        return;
    const assets = await (0, _asset_registry_js_1.listAssetMeta)();
    const byCategory = {};
    for (const a of assets)
        byCategory[a.category] = (byCategory[a.category] ?? 0) + 1;
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({
        total: assets.length,
        byCategory,
        duplicates: (0, _asset_registry_js_1.findDuplicates)(assets),
        hidden: assets.filter((a) => a.hidden).map((a) => a.id),
        // Full metadata list — small (no image bytes), ~150 B/record.
        assets,
    });
}
