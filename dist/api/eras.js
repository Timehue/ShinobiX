"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
const _utils_js_1 = require("./_utils.js");
const _ratelimit_js_1 = require("./_ratelimit.js");
const _era_js_1 = require("./_era.js");
const _legacy_track_js_1 = require("./_legacy-track.js");
/*
 * GET /api/eras — the world's chapter markers: current status, live milestone
 * progress toward the next unlock, and the credited history of past eras
 * (docs/legacy-system-plan.md §14). Read-only; unlocks happen server-side
 * (trigger hooks + the nightly cron pass), tuning happens via admin actions.
 */
async function handler(req, res) {
    (0, _utils_js_1.cors)(res, req);
    if (req.method === 'OPTIONS')
        return res.status(200).end();
    if (req.method !== 'GET')
        return res.status(405).end();
    if (!(0, _legacy_track_js_1.legacyEnabled)())
        return res.status(200).json({ eras: [] });
    if (!(await (0, _ratelimit_js_1.enforceRateLimitKv)(req, res, 'eras', 30, 60_000, null)))
        return;
    try {
        const eras = await (0, _era_js_1.getEraViews)();
        res.setHeader('Cache-Control', 'public, max-age=60');
        return res.status(200).json({ eras });
    }
    catch (err) {
        console.error('[eras]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
