"use strict";
/*
 * Combat-use stat growth (Stage 4, two-axis progression; see
 * docs/leveling-training-redesign-plan.md). Winning a fight grants a SMALL number
 * of stat points: a share auto-distributed into the stats the player has invested
 * in (a server-computable proxy for "how they fight"), the remainder into the
 * unspent-points pool. Bounded by a hard per-day cap so combat stays ~20% of the
 * training faucet and can't break the ~90-day-to-cap anchor. Ranked PvP grants
 * ZERO (skill-pure) — the caller simply doesn't invoke this for ranked wins.
 *
 * Pure + dependency-free so it unit-tests cleanly and is shared by the AI-fight
 * and (later) PvP-win reward endpoints. statCapForLevel mirrors the canonical
 * table in api/pvp/move.ts + constants/game.ts; pinned by api/_stat-growth.test.ts.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.COMBAT_USED_STAT_RATIO = exports.DAILY_COMBAT_STAT_CAP = exports.PVP_CASUAL_STAT_POINTS_PER_WIN = exports.AI_FIGHT_STAT_POINTS_PER_WIN = exports.STAT_GROWTH_KEYS = void 0;
exports.statCapForLevel = statCapForLevel;
exports.computeCombatStatGrowth = computeCombatStatGrowth;
exports.STAT_GROWTH_KEYS = [
    'strength', 'speed', 'intelligence', 'willpower',
    'bukijutsuOffense', 'bukijutsuDefense', 'taijutsuOffense', 'taijutsuDefense',
    'genjutsuOffense', 'genjutsuDefense', 'ninjutsuOffense', 'ninjutsuDefense',
];
// Small per-win base; the daily cap is the real bound. PvE grinds slightly higher
// than casual PvP (the AI-fight faucet is the main progression path).
exports.AI_FIGHT_STAT_POINTS_PER_WIN = 8;
exports.PVP_CASUAL_STAT_POINTS_PER_WIN = 6;
// Hard daily ceiling on combat-granted stat points (auto + pool). ~20% of a
// dedicated trainer's ~320/day, so combat shaves ~10-15 days off the ~90-day cap
// timeline without becoming the main faucet.
exports.DAILY_COMBAT_STAT_CAP = 60;
// 60% auto-grows the stats you use; 40% drops into the pool to hand-allocate.
exports.COMBAT_USED_STAT_RATIO = 0.6;
const STAT_BASE = 10;
// Per-rank stat ceiling — mirror of api/pvp/move.ts statCapForLevel (350/700/
// 1300/2100/2500 at levels 1/15/30/50/80). Pinned by api/_stat-growth.test.ts.
function statCapForLevel(level) {
    const lvl = Math.max(1, Math.floor(Number(level) || 1));
    if (lvl >= 80)
        return 2500;
    if (lvl >= 50)
        return 2100;
    if (lvl >= 30)
        return 1300;
    if (lvl >= 15)
        return 700;
    return 350;
}
// Weight each stat by how far it's invested above base — a proxy for "how the
// player fights." Returns the keys sorted by descending investment (stable: ties
// keep canonical STAT order).
function statsByInvestment(stats) {
    return [...exports.STAT_GROWTH_KEYS].sort((a, b) => {
        const wb = Math.max(0, (Number(stats[b]) || STAT_BASE) - STAT_BASE);
        const wa = Math.max(0, (Number(stats[a]) || STAT_BASE) - STAT_BASE);
        return wb - wa;
    });
}
/**
 * Compute the stat growth for one won fight.
 *   stats          — the winner's current 12 stats (from the sealed save)
 *   level          — winner level (for the per-rank cap)
 *   perWin         — base points for this fight type (AI_/PVP_ constants)
 *   remainingDaily — points left under the daily combat-stat cap
 * usedShare auto-grows the most-invested stats (skipping any already at their rank
 * cap — those points roll into the pool so nothing is wasted); freeShare → pool.
 */
function computeCombatStatGrowth(stats, level, perWin, remainingDaily) {
    const earned = Math.max(0, Math.min(Math.floor(perWin), Math.floor(remainingDaily)));
    if (earned <= 0)
        return { allocated: {}, unspentGain: 0, spent: 0 };
    const usedShare = Math.round(earned * exports.COMBAT_USED_STAT_RATIO);
    let freeShare = earned - usedShare;
    const cap = statCapForLevel(level);
    const order = statsByInvestment(stats);
    // Distribute across the INVESTED stats (proxy for "the stats you used"); if the
    // player has no build yet, fall back to the canonical order.
    const invested = order.filter((k) => (Number(stats[k]) || STAT_BASE) - STAT_BASE > 0);
    const targets = invested.length > 0 ? invested : order;
    const allocated = {};
    let usedLeft = usedShare;
    // Round-robin +1 across the targets (skipping any at their rank cap) so growth
    // spreads across the stats you build, not just the single top one. Terminates
    // when a full pass makes no progress (everything at cap) → remainder to pool.
    let progressed = true;
    while (usedLeft > 0 && progressed) {
        progressed = false;
        for (const k of targets) {
            if (usedLeft <= 0)
                break;
            if ((Number(stats[k]) || STAT_BASE) + (allocated[k] ?? 0) < cap) {
                allocated[k] = (allocated[k] ?? 0) + 1;
                usedLeft -= 1;
                progressed = true;
            }
        }
    }
    freeShare += usedLeft; // unusable used-points (all at cap) → pool (never wasted)
    return { allocated, unspentGain: freeShare, spent: earned };
}
