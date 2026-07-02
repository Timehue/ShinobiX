"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
const _utils_js_1 = require("../_utils.js");
const _ratelimit_js_1 = require("../_ratelimit.js");
const _legacy_defs_js_1 = require("../_legacy-defs.js");
const _legacy_score_js_1 = require("../_legacy-score.js");
const _legacy_track_js_1 = require("../_legacy-track.js");
/*
 * GET /api/legacy/definitions — the public Legacy codex.
 *
 * Names, rarity, category, village affinity, flavor, and titles only — the
 * requirement formulas deliberately stay server-side (design rule: players see
 * mystery and rumors, never a min-max checklist).
 */
async function handler(req, res) {
    (0, _utils_js_1.cors)(res, req);
    if (req.method === 'OPTIONS')
        return res.status(200).end();
    if (req.method !== 'GET')
        return res.status(405).end();
    if (!(0, _legacy_track_js_1.legacyEnabled)())
        return res.status(404).json({ error: 'Legacies are not awake yet.' });
    if (!(await (0, _ratelimit_js_1.enforceRateLimitKv)(req, res, 'legacy-definitions', 30, 60_000, null)))
        return;
    try {
        const overlay = await (0, _legacy_score_js_1.getLegacyOverlay)();
        const disabled = new Set(overlay.disabled ?? []);
        const legacies = _legacy_defs_js_1.LEGACY_DEFS.filter((d) => !disabled.has(d.id)).map((d) => ({
            id: d.id, name: d.name, rarity: d.rarity, category: d.category,
            villageAffinity: d.villageAffinity ?? null, title: d.title,
            flavor: d.flavor, badge: d.badge ?? null,
        }));
        res.setHeader('Cache-Control', 'public, max-age=300');
        return res.status(200).json({ minLevel: _legacy_defs_js_1.LEGACY_MIN_LEVEL, legacies });
    }
    catch (err) {
        console.error('[legacy/definitions]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
