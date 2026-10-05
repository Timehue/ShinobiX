/*
 * Combat stat growth (Stage 4, two-axis progression; see
 * docs/leveling-training-redesign-plan.md). Winning a fight grants stat points
 * directly to the character's unspent pool so the player can choose where they
 * go. Bounded by a hard per-day cap. PvE and eligible player PvP wins share the
 * same hard daily budget.
 *
 * Pure so it unit-tests cleanly and is shared by the AI-fight and PvP-win
 * reward endpoints. Rank cap lookup comes from combat-core so
 * progression rewards cannot drift from the combat resolver's caps.
 */

import { statCapForLevel } from './combat-core/formulas.js';
import { PVP_STAT_POINTS_PER_WIN } from '../shared/combat-growth-rules.js';
export { PVP_STAT_POINTS_PER_WIN, AI_PVE_STAT_POINTS_PER_WIN, DAILY_COMBAT_STAT_CAP } from '../shared/combat-growth-rules.js';

export { statCapForLevel };

export const STAT_GROWTH_KEYS = [
    'strength', 'speed', 'intelligence', 'willpower',
    'bukijutsuOffense', 'bukijutsuDefense', 'taijutsuOffense', 'taijutsuDefense',
    'genjutsuOffense', 'genjutsuDefense', 'ninjutsuOffense', 'ninjutsuDefense',
] as const;
export type StatKey = typeof STAT_GROWTH_KEYS[number];

// Per-win awards and the shared daily cap live in shared/combat-growth-rules.
// Combat-win stat rewards do not receive trait, encounter, or era multipliers.
// Compatibility for older imports; new callers use the generic PvP name.
export const PVP_CASUAL_STAT_POINTS_PER_WIN = PVP_STAT_POINTS_PER_WIN;
// Retained for compatibility with older imports. Combat growth is now entirely
// unspent so players choose how to allocate every point.
export const COMBAT_USED_STAT_RATIO = 0;

// ── Growth boosts (docs/leveling-without-xp-map.md §4.1) ────────────────────
// Retired XP boosts apply to training and other eligible non-combat grants.
// PvE/PvP wins use their direct per-win stat award and are excluded. STAT_GAIN_MULTIPLIER is the
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

/** Combine any source boost with the era dial under the shared aggregate cap. */
export function combinedStatMultiplier(sourceMultiplier: number): number {
    const source = Number.isFinite(sourceMultiplier) && sourceMultiplier >= 0 ? sourceMultiplier : 1;
    return Math.min(MAX_AGGREGATE_STAT_BOOST, source * statGainMultiplier());
}

/** Combined grant multiplier: (1 + bonusPct/100) × era dial, aggregate-capped. */
export function combinedStatBoost(bonusPct: number): number {
    return combinedStatMultiplier(1 + Math.max(0, bonusPct) / 100);
}

export interface CombatStatGrowth {
    allocated: Partial<Record<StatKey, number>>; // retained; combat grants leave this empty
    unspentGain: number;                          // free-pool points
    spent: number;                                // total granted (for the daily counter) = earned
}

/**
 * Compute the stat growth for one won fight. All awarded points go to the
 * unspent pool; stats and level remain unchanged until the player allocates them.
 * The first two arguments remain for compatibility with existing callers.
 */
export function computeCombatStatGrowth(
    _stats: Record<string, number>,
    _level: number,
    perWin: number,
    remainingDaily: number,
): CombatStatGrowth {
    const earned = Math.max(0, Math.min(Math.floor(perWin), Math.floor(remainingDaily)));
    return { allocated: {}, unspentGain: earned, spent: earned };
}
