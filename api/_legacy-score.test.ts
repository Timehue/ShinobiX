import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateLegacy, evaluateAllLegacies, pickSageOffers, SUSPICION_RARITY_CAP } from './_legacy-score.js';
import { LEGACY_BY_ID } from './_legacy-defs.js';
import { seedLegacyStatsFromSave, repeatKillWeight, isWinTradingRing, LEVEL_GAP_ZERO, RING_MIN_WINS } from './_legacy-track.js';
import type { LegacyStats } from './_legacy-track.js';

const NOW = 1_750_000_000_000;

test('repeat-kill decay: 1st and 2nd full, 3rd half, 4th quarter, then zero', () => {
    assert.equal(repeatKillWeight(0), 1);
    assert.equal(repeatKillWeight(1), 1);
    assert.equal(repeatKillWeight(2), 1);
    assert.equal(repeatKillWeight(3), 0.5);
    assert.equal(repeatKillWeight(4), 0.25);
    assert.equal(repeatKillWeight(5), 0);
    assert.equal(repeatKillWeight(99), 0);
    assert.ok(LEVEL_GAP_ZERO >= 10);
});

test('win-trading ring detection: rotations + single-target dominance trip it', () => {
    // A→B→C→A rotation across 12 wins: only 3 distinct victims.
    const ring = Array.from({ length: 12 }, (_, i) => ['bob', 'carl', 'dana'][i % 3]);
    assert.equal(isWinTradingRing(ring), true);
    // Honest ladder session: many different opponents.
    const honest = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'a', 'b', 'i', 'j'];
    assert.equal(isWinTradingRing(honest), false);
    // Too few wins to judge — never flags early.
    assert.equal(isWinTradingRing(ring.slice(0, RING_MIN_WINS - 1)), false);
    // 4 distinct but ONE target dominates the window (farm F + 3 throwaways):
    // dominance rule catches it even though distinct-count is 4.
    const dominated = ['F', 'x', 'F', 'y', 'F', 'z', 'F', 'x', 'F', 'y', 'F', 'z']; // F = 6/12
    assert.equal(isWinTradingRing(dominated), true);
    // Genuinely diverse 4-target window (no single dominator) stays clean.
    assert.equal(isWinTradingRing(['a', 'b', 'c', 'd', 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']), false);
});

test('bootstrap seeds from save counters with plausibility caps', () => {
    const seeded = seedLegacyStatsFromSave({
        level: 62, village: 'Moonshadow Village',
        totalMissionsCompleted: 320, totalAiKills: 999_999, totalPvpKills: 90,
        rankedWins: 40, totalTilesExplored: 2_500, warsWon: 5, warMvpCount: 2,
        lifetimeWarDamage: 80_000, cardClashWins: 33, totalPetWins: 61,
    }, NOW);
    assert.equal(seeded.missionCompletions, 320);
    assert.equal(seeded.pveKills, 1200, 'capped at plausibility ceiling');
    assert.equal(seeded.pvpWins, 90);
    assert.equal(seeded.rankedWins, 40);
    assert.equal(seeded.tilesExplored, 2500);
    assert.equal(seeded.warsWon, 5);
    assert.equal(seeded.villageTenureDays, 10, 'level-50+ villagers get the tenure floor');
    assert.equal(seeded.bootstrappedAt, NOW);
});

test('a basic legacy passes on its single floor and fails below it', () => {
    const def = LEGACY_BY_ID.get('proven-fighter')!;
    const pass = evaluateLegacy(def, { pvpWins: 15 });
    assert.equal(pass.eligible, true);
    assert.equal(pass.missing.length, 0);
    const fail = evaluateLegacy(def, { pvpWins: 14 });
    assert.equal(fail.eligible, false);
    assert.equal(fail.missing.length, 1);
});

test('mythic requires every floor — one gap sinks it, reasons say which', () => {
    const def = LEGACY_BY_ID.get('duel-sovereign')!;
    const stats: LegacyStats = {
        pvpWins: 500, sameRankWins: 200, bestKillStreak: 20, rankedWins: 150,
        higherLevelWins: 70, warPvpKills: 60, eliteKills: 300, eventCompletions: 3, // 3 < 8
    };
    const ev = evaluateLegacy(def, stats);
    assert.equal(ev.eligible, false);
    assert.equal(ev.missing.length, 1);
    assert.match(ev.missing[0], /eventCompletions/);
});

test('village affinity boosts score but never grants eligibility', () => {
    const def = LEGACY_BY_ID.get('moonlit-ghost')!; // Moonshadow affinity
    const stats: LegacyStats = { genjutsuKills: 600, pvpWins: 150, sectorDiscoveries: 80 };
    const home = evaluateLegacy(def, stats, { village: 'Moonshadow Village' });
    const away = evaluateLegacy(def, stats, { village: 'Stormveil' });
    assert.equal(home.eligible, true);
    assert.equal(away.eligible, true);
    assert.ok(home.score > away.score, 'affinity multiplies score');
    const under = evaluateLegacy(def, { ...stats, genjutsuKills: 10 }, { village: 'Moonshadow Village' });
    assert.equal(under.eligible, false, 'affinity cannot rescue an unmet floor');
});

test('threshold overlay retunes a floor without a deploy', () => {
    const def = LEGACY_BY_ID.get('proven-fighter')!;
    const ev = evaluateLegacy(def, { pvpWins: 20 }, { overlay: { thresholds: { 'proven-fighter': { pvpWins: 30 } } } });
    assert.equal(ev.eligible, false, 'overlay raised the floor above the value');
});

test('suspicion flags seal legendary+ but leave basic/rare offers open', () => {
    const stats: LegacyStats = {
        suspicionFlags: SUSPICION_RARITY_CAP + 1,
        // Comfortably meets a legendary (duel-king) AND a basic (proven-fighter).
        pvpWins: 300, rankedWins: 100, bestKillStreak: 12, eliteKills: 200,
    };
    const evals = evaluateAllLegacies(stats, { level: 60 });
    const duelKing = evals.find((e) => e.legacyId === 'duel-king')!;
    const proven = evals.find((e) => e.legacyId === 'proven-fighter')!;
    assert.equal(duelKing.eligible, false);
    assert.match(duelKing.missing[0], /flagged/);
    assert.equal(proven.eligible, true);
});

test('below level 50 nothing is eligible', () => {
    const evals = evaluateAllLegacies({ pvpWins: 999, missionCompletions: 999 }, { level: 49 });
    assert.ok(evals.every((e) => !e.eligible));
});

test('sage offers: best fit + different-category alternate + basic fallback, max 3', () => {
    const stats: LegacyStats = {
        // Eligible: duel-king (legendary pvp), proving-grounds (rare pvp),
        // mission-hound (rare pve), proven-fighter/field-hand/road-worn (basic).
        pvpWins: 300, rankedWins: 100, bestKillStreak: 12, eliteKills: 200,
        sameRankWins: 25, missionCompletions: 260, huntCompletions: 45,
    };
    const evals = evaluateAllLegacies(stats, { level: 55 });
    const offers = pickSageOffers(evals);
    assert.equal(offers.length, 3);
    assert.equal(offers[0].legacyId, 'duel-king', 'best fit is the highest rarity met');
    assert.ok(offers[1].category !== offers[0].category, 'alternate comes from a different category');
    assert.equal(offers[2].rarity, 'basic', 'third slot is the honest fallback');
    // No eligibility -> no offers, never a fabricated one.
    assert.deepEqual(pickSageOffers(evaluateAllLegacies({}, { level: 55 })), []);
});
