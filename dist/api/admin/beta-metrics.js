"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
const _utils_js_1 = require("../_utils.js");
const _auth_js_1 = require("../_auth.js");
const _ratelimit_js_1 = require("../_ratelimit.js");
const _beta_metrics_js_1 = require("../_beta-metrics.js");
// Admin-only beta readiness telemetry reader.
//
//   GET /api/admin/beta-metrics?days=14   (x-admin-password header)
//   -> 200 { ok, generatedAt, days, daily, totals }
async function handler(req, res) {
    (0, _utils_js_1.cors)(res, req);
    if (req.method === 'OPTIONS')
        return res.status(200).end();
    if (req.method !== 'GET' && req.method !== 'POST')
        return res.status(405).end();
    if (!(0, _auth_js_1.isAdmin)(req))
        return res.status(403).json({ error: 'Admin access required.' });
    if (!(0, _ratelimit_js_1.enforceRateLimit)(req, res, 'admin-beta-metrics', 60, 60_000))
        return;
    const body = typeof req.body === 'string'
        ? (() => { try {
            return JSON.parse(req.body);
        }
        catch {
            return {};
        } })()
        : (req.body ?? {});
    const days = Math.max(1, Math.min(Number(req.query?.days ?? body?.days ?? 14) || 14, 60));
    const snapshot = await (0, _beta_metrics_js_1.readBetaMetricsSnapshot)(days);
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ ok: true, ...snapshot });
}
