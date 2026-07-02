"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.eligibilityKey = void 0;
exports.default = handler;
const _storage_js_1 = require("../_storage.js");
const _utils_js_1 = require("../_utils.js");
const _auth_js_1 = require("../_auth.js");
const _ratelimit_js_1 = require("../_ratelimit.js");
const _legacy_track_js_1 = require("../_legacy-track.js");
const _legacy_score_js_1 = require("../_legacy-score.js");
/*
 * POST /api/legacy/evaluate { playerName } — recompute eligibility and cache
 * it at legacy:eligibility:<player>. Player-facing responses stay vague
 * (counts per rarity only); the full per-requirement breakdown is only in the
 * cache, which the ADMIN dashboard reads (api/admin/legacy.ts).
 */
const ELIGIBILITY_TTL_SECONDS = 7 * 24 * 60 * 60;
const eligibilityKey = (player) => `legacy:eligibility:${player}`;
exports.eligibilityKey = eligibilityKey;
async function handler(req, res) {
    (0, _utils_js_1.cors)(res, req);
    if (req.method === 'OPTIONS')
        return res.status(200).end();
    if (req.method !== 'POST')
        return res.status(405).end();
    if (!(0, _legacy_track_js_1.legacyEnabled)())
        return res.status(404).json({ error: 'Legacies are not awake yet.' });
    try {
        const body = (typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {}));
        const playerName = (0, _utils_js_1.safeName)(String(body.playerName ?? ''));
        if (!playerName)
            return res.status(400).json({ error: 'Missing playerName.' });
        const identity = await (0, _auth_js_1.authedPlayerOrAdmin)(req, playerName);
        if (!identity)
            return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) {
            return res.status(403).json({ error: 'You can only evaluate yourself.' });
        }
        if (!identity.admin && !(await (0, _ratelimit_js_1.enforceRateLimitKv)(req, res, 'legacy-evaluate', 2, 60_000, identity.name)))
            return;
        const rec = await _storage_js_1.kv.get(`save:${playerName}`);
        const char = (rec?.character ?? null);
        if (!char)
            return res.status(404).json({ error: 'Save not found.' });
        const stats = await (0, _legacy_track_js_1.getLegacyStats)(playerName, char);
        const overlay = await (0, _legacy_score_js_1.getLegacyOverlay)();
        const level = Number(char.level ?? 0) || 0;
        const village = typeof char.village === 'string' ? char.village : null;
        const evals = (0, _legacy_score_js_1.evaluateAllLegacies)(stats, { level, village, overlay });
        const evaluatedAt = Date.now();
        await _storage_js_1.kv.set((0, exports.eligibilityKey)(playerName), { evaluatedAt, level, village, entries: evals }, { ex: ELIGIBILITY_TTL_SECONDS });
        const eligibleCounts = { basic: 0, rare: 0, legendary: 0, mythic: 0 };
        for (const ev of evals)
            if (ev.eligible)
                eligibleCounts[ev.rarity] += 1;
        return res.status(200).json({ ok: true, evaluatedAt, eligibleCounts });
    }
    catch (err) {
        console.error('[legacy/evaluate]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
