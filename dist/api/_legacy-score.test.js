"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const _legacy_score_js_1 = require("./_legacy-score.js");
const _legacy_defs_js_1 = require("./_legacy-defs.js");
const _legacy_track_js_1 = require("./_legacy-track.js");
const NOW = 1_750_000_000_000;
(0, node_test_1.test)('repeat-kill decay: 1st and 2nd full, 3rd half, 4th quarter, then zero', () => {
    strict_1.default.equal((0, _legacy_track_js_1.repeatKillWeight)(0), 1);
    strict_1.default.equal((0, _legacy_track_js_1.repeatKillWeight)(1), 1);
    strict_1.default.equal((0, _legacy_track_js_1.repeatKillWeight)(2), 1);
    strict_1.default.equal((0, _legacy_track_js_1.repeatKillWeight)(3), 0.5);
    strict_1.default.equal((0, _legacy_track_js_1.repeatKillWeight)(4), 0.25);
    strict_1.default.equal((0, _legacy_track_js_1.repeatKillWeight)(5), 0);
    strict_1.default.equal((0, _legacy_track_js_1.repeatKillWeight)(99), 0);
    strict_1.default.ok(_legacy_track_js_1.LEVEL_GAP_ZERO >= 10);
});
(0, node_test_1.test)('win-trading ring detection: rotations + single-target dominance trip it', () => {
    // A→B→C→A rotation across 12 wins: only 3 distinct victims.
    const ring = Array.from({ length: 12 }, (_, i) => ['bob', 'carl', 'dana'][i % 3]);
    strict_1.default.equal((0, _legacy_track_js_1.isWinTradingRing)(ring), true);
    // Honest ladder session: many different opponents.
    const honest = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'a', 'b', 'i', 'j'];
    strict_1.default.equal((0, _legacy_track_js_1.isWinTradingRing)(honest), false);
    // Too few wins to judge — never flags early.
    strict_1.default.equal((0, _legacy_track_js_1.isWinTradingRing)(ring.slice(0, _legacy_track_js_1.RING_MIN_WINS - 1)), false);
    // 4 distinct but ONE target dominates the window (farm F + 3 throwaways):
    // dominance rule catches it even though distinct-count is 4.
    const dominated = ['F', 'x', 'F', 'y', 'F', 'z', 'F', 'x', 'F', 'y', 'F', 'z']; // F = 6/12
    strict_1.default.equal((0, _legacy_track_js_1.isWinTradingRing)(dominated), true);
    // Genuinely diverse 4-target window (no single dominator) stays clean.
    strict_1.default.equal((0, _legacy_track_js_1.isWinTradingRing)(['a', 'b', 'c', 'd', 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']), false);
});
(0, node_test_1.test)('bootstrap seeds from save counters with plausibility caps', () => {
    const seeded = (0, _legacy_track_js_1.seedLegacyStatsFromSave)({
        level: 62, village: 'Moonshadow Village',
        totalMissionsCompleted: 320, totalAiKills: 999_999, totalPvpKills: 90,
        rankedWins: 40, totalTilesExplored: 2_500, warsWon: 5, warMvpCount: 2,
        lifetimeWarDamage: 80_000, cardClashWins: 33, totalPetWins: 61,
    }, NOW);
    strict_1.default.equal(seeded.missionCompletions, 320);
    strict_1.default.equal(seeded.pveKills, 1200, 'capped at plausibility ceiling');
    strict_1.default.equal(seeded.pvpWins, 90);
    strict_1.default.equal(seeded.rankedWins, 40);
    strict_1.default.equal(seeded.tilesExplored, 2500);
    strict_1.default.equal(seeded.warsWon, 5);
    strict_1.default.equal(seeded.villageTenureDays, 10, 'level-50+ villagers get the tenure floor');
    strict_1.default.equal(seeded.bootstrappedAt, NOW);
});
(0, node_test_1.test)('a basic legacy passes on its single floor and fails below it', () => {
    const def = _legacy_defs_js_1.LEGACY_BY_ID.get('proven-fighter');
    const pass = (0, _legacy_score_js_1.evaluateLegacy)(def, { pvpWins: 15 });
    strict_1.default.equal(pass.eligible, true);
    strict_1.default.equal(pass.missing.length, 0);
    const fail = (0, _legacy_score_js_1.evaluateLegacy)(def, { pvpWins: 14 });
    strict_1.default.equal(fail.eligible, false);
    strict_1.default.equal(fail.missing.length, 1);
});
(0, node_test_1.test)('mythic requires every floor — one gap sinks it, reasons say which', () => {
    const def = _legacy_defs_js_1.LEGACY_BY_ID.get('duel-sovereign');
    const stats = {
        pvpWins: 500, sameRankWins: 200, bestKillStreak: 20, rankedWins: 150,
        higherLevelWins: 70, warPvpKills: 60, eliteKills: 300, eventCompletions: 3, // 3 < 8
    };
    const ev = (0, _legacy_score_js_1.evaluateLegacy)(def, stats);
    strict_1.default.equal(ev.eligible, false);
    strict_1.default.equal(ev.missing.length, 1);
    strict_1.default.match(ev.missing[0], /eventCompletions/);
});
(0, node_test_1.test)('village affinity boosts score but never grants eligibility', () => {
    const def = _legacy_defs_js_1.LEGACY_BY_ID.get('moonlit-ghost'); // Moonshadow affinity
    const stats = { genjutsuKills: 600, pvpWins: 150, sectorDiscoveries: 80 };
    const home = (0, _legacy_score_js_1.evaluateLegacy)(def, stats, { village: 'Moonshadow Village' });
    const away = (0, _legacy_score_js_1.evaluateLegacy)(def, stats, { village: 'Stormveil' });
    strict_1.default.equal(home.eligible, true);
    strict_1.default.equal(away.eligible, true);
    strict_1.default.ok(home.score > away.score, 'affinity multiplies score');
    const under = (0, _legacy_score_js_1.evaluateLegacy)(def, { ...stats, genjutsuKills: 10 }, { village: 'Moonshadow Village' });
    strict_1.default.equal(under.eligible, false, 'affinity cannot rescue an unmet floor');
});
(0, node_test_1.test)('threshold overlay retunes a floor without a deploy', () => {
    const def = _legacy_defs_js_1.LEGACY_BY_ID.get('proven-fighter');
    const ev = (0, _legacy_score_js_1.evaluateLegacy)(def, { pvpWins: 20 }, { overlay: { thresholds: { 'proven-fighter': { pvpWins: 30 } } } });
    strict_1.default.equal(ev.eligible, false, 'overlay raised the floor above the value');
});
(0, node_test_1.test)('suspicion flags seal legendary+ but leave basic/rare offers open', () => {
    const stats = {
        suspicionFlags: _legacy_score_js_1.SUSPICION_RARITY_CAP + 1,
        // Comfortably meets a legendary (duel-king) AND a basic (proven-fighter).
        pvpWins: 300, rankedWins: 100, bestKillStreak: 12, eliteKills: 200,
    };
    const evals = (0, _legacy_score_js_1.evaluateAllLegacies)(stats, { level: 60 });
    const duelKing = evals.find((e) => e.legacyId === 'duel-king');
    const proven = evals.find((e) => e.legacyId === 'proven-fighter');
    strict_1.default.equal(duelKing.eligible, false);
    strict_1.default.match(duelKing.missing[0], /flagged/);
    strict_1.default.equal(proven.eligible, true);
});
(0, node_test_1.test)('below level 50 nothing is eligible', () => {
    const evals = (0, _legacy_score_js_1.evaluateAllLegacies)({ pvpWins: 999, missionCompletions: 999 }, { level: 49 });
    strict_1.default.ok(evals.every((e) => !e.eligible));
});
(0, node_test_1.test)('sage offers: best fit + different-category alternate + basic fallback, max 3', () => {
    const stats = {
        // Eligible: duel-king (legendary pvp), proving-grounds (rare pvp),
        // mission-hound (rare pve), proven-fighter/field-hand/road-worn (basic).
        pvpWins: 300, rankedWins: 100, bestKillStreak: 12, eliteKills: 200,
        sameRankWins: 25, missionCompletions: 260, huntCompletions: 45,
    };
    const evals = (0, _legacy_score_js_1.evaluateAllLegacies)(stats, { level: 55 });
    const offers = (0, _legacy_score_js_1.pickSageOffers)(evals);
    strict_1.default.equal(offers.length, 3);
    strict_1.default.equal(offers[0].legacyId, 'duel-king', 'best fit is the highest rarity met');
    strict_1.default.ok(offers[1].category !== offers[0].category, 'alternate comes from a different category');
    strict_1.default.equal(offers[2].rarity, 'basic', 'third slot is the honest fallback');
    // No eligibility -> no offers, never a fabricated one.
    strict_1.default.deepEqual((0, _legacy_score_js_1.pickSageOffers)((0, _legacy_score_js_1.evaluateAllLegacies)({}, { level: 55 })), []);
});
