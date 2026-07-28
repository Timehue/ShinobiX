/*
 * Combat-use stat growth (Stage 4, two-axis progression; see
 * docs/leveling-training-redesign-plan.md). Winning a fight grants a SMALL number
 * of stat points: a share auto-distributed into the stats the player has invested
 * in (a server-computable proxy for "how they fight"), the remainder into the
 * unspent-points pool. Bounded by a hard per-day cap so combat stays ~20% of the
 * training faucet and can't break the ~90-day-to-cap anchor. Ranked PvP grants
 * ZERO (skill-pure) — the caller simply doesn't invoke this for ranked wins.
 *
 * Pure so it unit-tests cleanly and is shared by the AI-fight and (later)
 * PvP-win reward endpoints. Rank cap lookup comes from combat-core so
 * progression rewards cannot drift from the combat resolver's caps.
 */

import { statCapForLevel } from './combat-core/formulas.js';

export { statCapForLevel };

export const STAT_GROWTH_KEYS = [
    'strength', 'speed', 'intelligence', 'willpower',
    'bukijutsuOffense', 'bukijutsuDefense', 'taijutsuOffense', 'taijutsuDefense',
    'genjutsuOffense', 'genjutsuDefense', 'ninjutsuOffense', 'ninjutsuDefense',
] as const;
export type StatKey = typeof STAT_GROWTH_KEYS[number];

// Small per-win base; the daily slice is the real bound.
export const PVP_CASUAL_STAT_POINTS_PER_WIN = 6;
// The PvP SLICE of the daily growth budget (docs/leveling-without-xp-map.md §4):
// three serious wins' worth. The daily-checklist slice (~50) lives on the
// once-per-day mission claims and needs no shared counter; this key bounds only
// combat growth so dailies stay the bulk of a day's growth. The counter charges
// BASE points — trait/era boosts multiply the payout after slice accounting.
export const DAILY_COMBAT_STAT_CAP = 18;
// 60% auto-grows the stats you use; 40% drops into the pool to hand-allocate.
export const COMBAT_USED_STAT_RATIO = 0.6;

// ── Growth boosts (docs/leveling-without-xp-map.md §4.1) ────────────────────
// Every retired XP-boost is now a stat-gain boost. STAT_GAIN_MULTIPLIER is the
// server-env ERA DIAL (default 1): flip it on Railway so a later generation of
// players caps far sooner — no client constant, no rebuild, surfaced to the UI
// via grant responses. MAX_AGGREGATE_STAT_BOOST bounds the COMBINED multiplier
// (per-source bonus × era dial) so stacking can never run away.
export const MAX_AGGREGATE_STAT_BOOST = 2.5;

export function statGainMultiplier(): number {
    const raw = Number(process.env.STAT_GAIN_MULTIPLIER ?? 1);
    if (!Number.isFinite(raw) || raw <= 0) return 1;
    return Math.min(MAX_AGGREGATE_STAT_BOOST, raw);
}

/** Combined grant multiplier: (1 + bonusPct/100) × era dial, aggregate-capped. */
export function combinedStatBoost(bonusPct: number): number {
    const bonus = 1 + Math.max(0, bonusPct) / 100;
    return Math.min(MAX_AGGREGATE_STAT_BOOST, bonus * statGainMultiplier());
}

const STAT_BASE = 10;

// Weight each stat by how far it's invested above base — a proxy for "how the
// player fights." Returns the keys sorted by descending investment (stable: ties
// keep canonical STAT order).
function statsByInvestment(stats: Record<string, number>): StatKey[] {
    return [...STAT_GROWTH_KEYS].sort((a, b) => {
        const wb = Math.max(0, (Number(stats[b]) || STAT_BASE) - STAT_BASE);
        const wa = Math.max(0, (Number(stats[a]) || STAT_BASE) - STAT_BASE);
        return wb - wa;
    });
}

export interface CombatStatGrowth {
    allocated: Partial<Record<StatKey, number>>; // per-stat auto-growth
    unspentGain: number;                          // free-pool points
    spent: number;                                // total granted (for the daily counter) = earned
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
export function computeCombatStatGrowth(
    stats: Record<string, number>,
    level: number,
    perWin: number,
    remainingDaily: number,
): CombatStatGrowth {
    const earned = Math.max(0, Math.min(Math.floor(perWin), Math.floor(remainingDaily)));
    if (earned <= 0) return { allocated: {}, unspentGain: 0, spent: 0 };
    const usedShare = Math.round(earned * COMBAT_USED_STAT_RATIO);
    let freeShare = earned - usedShare;
    const cap = statCapForLevel(level);
    const order = statsByInvestment(stats);
    // Distribute across the INVESTED stats (proxy for "the stats you used"); if the
    // player has no build yet, fall back to the canonical order.
    const invested = order.filter((k) => (Number(stats[k]) || STAT_BASE) - STAT_BASE > 0);
    const targets = invested.length > 0 ? invested : order;
    const allocated: Partial<Record<StatKey, number>> = {};
    let usedLeft = usedShare;
    // Round-robin +1 across the targets (skipping any at their rank cap) so growth
    // spreads across the stats you build, not just the single top one. Terminates
    // when a full pass makes no progress (everything at cap) → remainder to pool.
    let progressed = true;
    while (usedLeft > 0 && progressed) {
        progressed = false;
        for (const k of targets) {
            if (usedLeft <= 0) break;
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
