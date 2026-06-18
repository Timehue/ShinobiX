"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
const _storage_js_1 = require("../_storage.js");
const _utils_js_1 = require("../_utils.js");
const _auth_js_1 = require("../_auth.js");
const _ratelimit_js_1 = require("../_ratelimit.js");
const _audit_js_1 = require("../_audit.js");
const _ranked_season_js_1 = require("../cron/_ranked-season.js");
/*
 * /api/admin/ranked-season — admin control for ranked seasons.
 *
 *   GET                         → { active, current }    (status for the panel)
 *   POST { action: 'start' }    → start season 1 (no-op if already active)
 *   POST { action: 'rollover' } → force-end the current season NOW (reward +
 *                                 archive + soft reset) and begin the next
 *
 * Ranked seasons do NOT auto-start; an admin kicks them off here. Admin-gated
 * via the x-admin-password header (same as the other admin endpoints).
 */
async function handler(req, res) {
    (0, _utils_js_1.cors)(res, req);
    if (req.method === 'OPTIONS')
        return res.status(200).end();
    if (req.method === 'GET') {
        if (!(0, _auth_js_1.isAdmin)(req))
            return res.status(401).json({ error: 'Unauthorized.' });
        const current = await _storage_js_1.kv.get(_ranked_season_js_1.SEASON_CURRENT_KEY);
        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).json({ active: !!current, current: current ?? null });
    }
    if (req.method !== 'POST')
        return res.status(405).end();
    if (!(0, _ratelimit_js_1.enforceRateLimit)(req, res, 'admin-ranked-season', 30, 5 * 60_000))
        return;
    if (!(0, _auth_js_1.isAdmin)(req))
        return res.status(401).json({ error: 'Unauthorized.' });
    try {
        const body = (typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {}));
        const action = typeof body.action === 'string' ? body.action : '';
        if (action === 'start') {
            const result = await (0, _ranked_season_js_1.startRankedSeason)();
            await (0, _audit_js_1.recordAudit)({ domain: 'reward', actor: 'admin', action: 'ranked-season.start', meta: { result } }).catch(() => undefined);
            return res.status(200).json(result);
        }
        if (action === 'rollover') {
            const result = await (0, _ranked_season_js_1.forceRankedSeasonRollover)();
            await (0, _audit_js_1.recordAudit)({ domain: 'reward', actor: 'admin', action: 'ranked-season.rollover', meta: { result } }).catch(() => undefined);
            return res.status(200).json(result);
        }
        return res.status(400).json({ error: "Unknown action. Use 'start' or 'rollover'." });
    }
    catch (err) {
        console.error('[admin/ranked-season]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
