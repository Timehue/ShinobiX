"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
const _utils_js_1 = require("./_utils.js");
const _auth_js_1 = require("./_auth.js");
const _ratelimit_js_1 = require("./_ratelimit.js");
const _announce_js_1 = require("./_announce.js");
const _legacy_track_js_1 = require("./_legacy-track.js");
/*
 * GET /api/hall-of-legends?type=<entryType> — permanent server history
 * (docs/legacy-system-plan.md §13). Entries are append-only; revoked ones
 * render with their status (never silently erased), hidden ones are
 * admin-only. Corrections happen through api/admin/legacy.ts.
 */
async function handler(req, res) {
    (0, _utils_js_1.cors)(res, req);
    if (req.method === 'OPTIONS')
        return res.status(200).end();
    if (req.method !== 'GET')
        return res.status(405).end();
    if (!(0, _legacy_track_js_1.legacyEnabled)())
        return res.status(200).json({ entries: [] });
    if (!(await (0, _ratelimit_js_1.enforceRateLimitKv)(req, res, 'hall-of-legends', 30, 60_000, null)))
        return;
    try {
        const admin = (0, _auth_js_1.isAdmin)(req);
        const type = typeof req.query.type === 'string' ? req.query.type : '';
        const limit = Math.max(1, Math.min(200, Math.floor(Number(req.query.limit) || 100)));
        let entries = await (0, _announce_js_1.readHallEntries)({ includeHidden: admin, limit: 500 });
        if (type)
            entries = entries.filter((e) => e.entryType === type);
        res.setHeader('Cache-Control', 'public, max-age=60');
        return res.status(200).json({ entries: entries.slice(0, limit) });
    }
    catch (err) {
        console.error('[hall-of-legends]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
