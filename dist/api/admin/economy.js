"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
const _utils_js_1 = require("../_utils.js");
const _auth_js_1 = require("../_auth.js");
const _ratelimit_js_1 = require("../_ratelimit.js");
const _economy_js_1 = require("../_economy.js");
const _war_telemetry_js_1 = require("../_war-telemetry.js");
const _war_map_sectors_js_1 = require("../_war-map-sectors.js");
// Admin-only economy telemetry reader (docs/economy-telemetry-plan.md).
//
// Surfaces the running created/destroyed aggregates per currency (faucet-vs-sink
// / inflation), a slice of the recent currency-delta transactions, and the
// duplicate-txnId anomaly flag. Also folds in the Village-War economy snapshot
// (WR + treasury-seal faucet-vs-sink, tax split, maintenance, dormancy per
// village — plan §8). Read-only, admin-gated.
//
//   GET /api/admin/economy?limit=200   (x-admin-password header)
//   → 200 { aggregates, recent, duplicateTxnIds, war }
async function handler(req, res) {
    (0, _utils_js_1.cors)(res, req);
    if (req.method === 'OPTIONS')
        return res.status(200).end();
    if (req.method !== 'GET' && req.method !== 'POST')
        return res.status(405).end();
    if (!(0, _auth_js_1.isAdmin)(req))
        return res.status(403).json({ error: 'Admin access required.' });
    if (!(0, _ratelimit_js_1.enforceRateLimit)(req, res, 'admin-economy', 60, 60_000))
        return;
    const body = typeof req.body === 'string'
        ? (() => { try {
            return JSON.parse(req.body);
        }
        catch {
            return {};
        } })()
        : (req.body ?? {});
    const limit = Math.max(1, Math.min(Number(req.query?.limit ?? body?.limit ?? 200) || 200, 5000));
    const snapshot = await (0, _economy_js_1.readEconomySnapshot)(limit);
    // Village-War economy telemetry (Phase 8) — per-village WR/seal faucet-vs-sink,
    // tax split, maintenance, dormancy. Empty until ENABLE_VILLAGE_WAR is on.
    const war = await (0, _war_telemetry_js_1.readWarEcoSnapshot)(_war_map_sectors_js_1.WAR_VILLAGES, limit);
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ ok: true, ...snapshot, war });
}
