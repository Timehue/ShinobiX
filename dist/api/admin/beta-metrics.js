"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
const _utils_js_1 = require("../_utils.js");
const _auth_js_1 = require("../_auth.js");
const _ratelimit_js_1 = require("../_ratelimit.js");
const _storage_js_1 = require("../_storage.js");
const _beta_metrics_js_1 = require("../_beta-metrics.js");
const _beta_report_js_1 = require("../_beta-report.js");
// Admin-only beta readiness telemetry reader.
//
//   GET /api/admin/beta-metrics?days=14&includePopulation=1&format=text
// Population scans are opt-in because save:* lives on the remote overlay. The
// response remains aggregate-only: names and raw save records are never returned.
async function handler(req, res) {
    (0, _utils_js_1.cors)(res, req);
    if (req.method === 'OPTIONS')
        return res.status(200).end();
    if (req.method !== 'GET' && req.method !== 'POST')
        return res.status(405).end();
    if (!(0, _auth_js_1.isFullAdmin)(req))
        return res.status(403).json({ error: 'Full admin access required.' });
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
    const includePopulation = String(req.query?.includePopulation ?? body?.includePopulation ?? '') === '1'
        || body?.includePopulation === true;
    let population;
    if (includePopulation) {
        const keys = await _storage_js_1.kv.keys('save:*');
        const records = [];
        for (let i = 0; i < keys.length; i += 200) {
            records.push(...await _storage_js_1.kv.mget(...keys.slice(i, i + 200)));
        }
        population = (0, _beta_report_js_1.buildBetaPopulationSnapshot)(records);
    }
    const report = (0, _beta_report_js_1.buildDailyBetaReport)(snapshot, population);
    res.setHeader('Cache-Control', 'no-store');
    if (String(req.query?.format ?? body?.format ?? '').toLowerCase() === 'text') {
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        return res.status(200).send((0, _beta_report_js_1.formatDailyBetaReport)(report));
    }
    return res.status(200).json({ ok: true, ...report });
}
