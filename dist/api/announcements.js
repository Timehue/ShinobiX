"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
const _utils_js_1 = require("./_utils.js");
const _ratelimit_js_1 = require("./_ratelimit.js");
const _announce_js_1 = require("./_announce.js");
const _legacy_track_js_1 = require("./_legacy-track.js");
/*
 * GET /api/announcements?since=<id>&limit=<n> — the world news feed
 * (docs/legacy-system-plan.md §12). Read-only; announcements are only ever
 * minted server-side by game moments (legacy awakenings, era unlocks,
 * server-firsts) through api/_announce.ts.
 */
async function handler(req, res) {
    (0, _utils_js_1.cors)(res, req);
    if (req.method === 'OPTIONS')
        return res.status(200).end();
    if (req.method !== 'GET')
        return res.status(405).end();
    if (!(0, _legacy_track_js_1.legacyEnabled)())
        return res.status(200).json({ announcements: [], latestId: 0 });
    if (!(await (0, _ratelimit_js_1.enforceRateLimitKv)(req, res, 'announcements', 30, 60_000, null)))
        return;
    try {
        const since = Math.max(0, Math.floor(Number(req.query.since) || 0));
        const limit = Math.max(1, Math.min(50, Math.floor(Number(req.query.limit) || 20)));
        const announcements = await (0, _announce_js_1.recentAnnouncements)(limit, since);
        res.setHeader('Cache-Control', 'public, max-age=15');
        return res.status(200).json({
            announcements,
            latestId: announcements.length > 0 ? announcements[0].id : since,
        });
    }
    catch (err) {
        console.error('[announcements]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
