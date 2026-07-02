"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
const _storage_js_1 = require("../_storage.js");
const _utils_js_1 = require("../_utils.js");
const _auth_js_1 = require("../_auth.js");
const _ratelimit_js_1 = require("../_ratelimit.js");
const _legacy_track_js_1 = require("../_legacy-track.js");
const _legacy_score_js_1 = require("../_legacy-score.js");
const _legacy_core_js_1 = require("../_legacy-core.js");
const _legacy_defs_js_1 = require("../_legacy-defs.js");
/*
 * GET /api/legacy/stats?playerName=... — the LegacyPanel's single fetch.
 *
 * Returns the player's own Legacy state: accepted legacy + stage, active
 * trial WITH live progress, an active Sage offer if one is waiting, and a
 * deliberately vague "strongest paths" summary (bucketed tiers, never raw
 * counters or thresholds — the mystery rule).
 */
const TIERS = ['stirring', 'taking shape', 'strong', 'dominant'];
async function handler(req, res) {
    (0, _utils_js_1.cors)(res, req);
    if (req.method === 'OPTIONS')
        return res.status(200).end();
    if (req.method !== 'GET')
        return res.status(405).end();
    if (!(0, _legacy_track_js_1.legacyEnabled)())
        return res.status(404).json({ error: 'Legacies are not awake yet.' });
    try {
        const playerName = (0, _utils_js_1.safeName)(String(req.query.playerName ?? ''));
        if (!playerName)
            return res.status(400).json({ error: 'Missing playerName.' });
        const identity = await (0, _auth_js_1.authedPlayerOrAdmin)(req, playerName);
        if (!identity)
            return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) {
            return res.status(403).json({ error: 'You can only view your own legacy.' });
        }
        if (!identity.admin && !(await (0, _ratelimit_js_1.enforceRateLimitKv)(req, res, 'legacy-stats', 20, 60_000, identity.name)))
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
        // Bucketed per-category strength: max score across that category's
        // legacies, tiered — enough for rumors and the panel, no formulas.
        const byCategory = new Map();
        for (const ev of evals) {
            byCategory.set(ev.category, Math.max(byCategory.get(ev.category) ?? 0, ev.score));
        }
        const strongest = [...byCategory.entries()]
            .filter(([, s]) => s >= 0.25)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 4)
            .map(([category, s]) => ({
            category,
            tier: TIERS[Math.min(TIERS.length - 1, Math.floor(Math.min(s, 1.31) / 0.35))],
        }));
        const eligibleCounts = { basic: 0, rare: 0, legendary: 0, mythic: 0 };
        for (const ev of evals)
            if (ev.eligible)
                eligibleCounts[ev.rarity] += 1;
        const legacy = (char.legacy ?? null);
        const trialRaw = await _storage_js_1.kv.get((0, _legacy_core_js_1.legacyTrialKey)(playerName));
        const trial = trialRaw && _legacy_defs_js_1.LEGACY_BY_ID.has(trialRaw.legacyId)
            ? { ...trialRaw, objectives: (0, _legacy_core_js_1.trialProgress)(trialRaw, stats) }
            : null;
        const trialIntro = trialRaw && _legacy_defs_js_1.LEGACY_BY_ID.has(trialRaw.legacyId)
            ? (0, _legacy_core_js_1.trialIntroFor)(_legacy_defs_js_1.LEGACY_BY_ID.get(trialRaw.legacyId), trialRaw.kind)
            : null;
        const offer = await _storage_js_1.kv.get(`legacy:sage-offer:${playerName}`);
        return res.status(200).json({
            level,
            minLevelReached: level >= 50,
            legacy,
            // The accepted legacy's category, resolved server-side so the client
            // can match the player to their trial-giver emissary without
            // shipping the 100-def table (lib/legacy-emissaries.ts).
            legacyCategory: legacy ? (_legacy_defs_js_1.LEGACY_BY_ID.get(legacy.legacyId)?.category ?? null) : null,
            trial,
            trialIntro,
            offer: offer && offer.status === 'spawned' ? offer : null,
            strongest,
            eligibleCounts,
        });
    }
    catch (err) {
        console.error('[legacy/stats]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}
