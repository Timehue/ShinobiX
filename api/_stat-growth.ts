/*
 * Combat stat growth (Stage 4, two-axis progression; see
 * docs/leveling-training-redesign-plan.md). Winning a fight grants stat points
 * directly to the character's unspent pool so the player can choose where they
 * go. Bounded by a hard per-day cap: PvE wins, eligible player PvP wins and the
 * hunt / field mission claims share one daily budget.
 *
 * Pure so it unit-tests cleanly and is shared by the AI-fight and PvP-win
 * reward endpoints. Rank cap lookup comes from combat-core so
 * progression rewards cannot drift from the combat resolver's caps.
 */

import { statCapForLevel } from './combat-core/formulas.js';
import { economyDial } from './_economy-dials.js';
import { PVP_STAT_POINTS_PER_WIN, DAILY_STAT_POINT_CAP } from '../shared/combat-growth-rules.js';
export { PVP_STAT_POINTS_PER_WIN, AI_PVE_STAT_POINTS_PER_WIN, DAILY_STAT_POINT_CAP } from '../shared/combat-growth-rules.js';

export { statCapForLevel };

// ── The one shared daily stat-point budget (owner ruling A1, 2026-10) ───────
// Hunt and field claims, PvE wins and PvP wins reserve their points against the
// `combat-stat-count:<player>:<UTC day>` row (api/pvp/_combat-stat-budget.ts);
// it replaced the separate 18/day combat cap and the first-10-hunt / 5-field
// checklist rule. Env dial DAILY_STAT_POINT_CAP: whole points in [0, 300],
// anything else reads as the default 60. 0 stops every activity stat grant.
export const DAILY_STAT_POINT_CAP_MAX = 300;

export function dailyStatPointCap(): number {
    const value = economyDial('DAILY_STAT_POINT_CAP', DAILY_STAT_POINT_CAP, { min: 0, max: DAILY_STAT_POINT_CAP_MAX });
    return Number.isInteger(value) ? value : DAILY_STAT_POINT_CAP;
}

// The cap every reservation passes. Resolved once at boot so every source in
// one process reserves against the same number; a Railway variable change
// restarts the service, which re-reads it. The combat name is kept so the
// existing PvE / PvP reservations draw from the shared budget unchanged.
export const DAILY_COMBAT_STAT_CAP = dailyStatPointCap();

export const STAT_GROWTH_KEYS = [
    'strength', 'speed', 'intelligence', 'willpower',
    'bukijutsuOffense', 'bukijutsuDefense', 'taijutsuOffense', 'taijutsuDefense',
    'genjutsuOffense', 'genjutsuDefense', 'ninjutsuOffense', 'ninjutsuDefense',
] as const;
export type StatKey = typeof STAT_GROWTH_KEYS[number];

// Per-win awards and the shared daily cap live in shared/combat-growth-rules.
// Combat-win stat rewards do not receive trait, encounter, or era multipliers.
// The one exception is the admin growth event on casual PvP wins: it scales the
// REQUEST before the shared daily budget is reserved, so it fills the budget
// sooner but never raises it (api/pvp/claim-rewards.ts, I-12).
// Compatibility for older imports; new callers use the generic PvP name.
export const PVP_CASUAL_STAT_POINTS_PER_WIN = PVP_STAT_POINTS_PER_WIN;
// Retained for compatibility with older imports. Combat growth is now entirely
// unspent so players choose how to allocate every point.
export const COMBAT_USED_STAT_RATIO = 0;

// ── Growth boosts (docs/leveling-without-xp-map.md §4.1) ────────────────────
// Retired XP boosts apply to training and other eligible non-combat grants.
// PvE/PvP wins use their direct per-win stat award and are excluded. STAT_GAIN_MULTIPLIER is the
// server-env ERA DIAL (default 1): flip it on Railway so a later generation of
// players caps far sooner — no client constant, no rebuild, surfaced on the
// game-state frame (api/game-state.ts progressionDials) so the Training preview
// shows what the seal pays. MAX_AGGREGATE_STAT_BOOST bounds the COMBINED
// multiplier (per-source bonus × era dial) so stacking can never run away.
// MIRROR: shinobij.client/src/lib/training-config.ts MAX_AGGREGATE_STAT_BOOST.
export const MAX_AGGREGATE_STAT_BOOST = 2.5;

export function statGainMultiplier(): number {
    const raw = Number(process.env.STAT_GAIN_MULTIPLIER ?? 1);
    if (!Number.isFinite(raw) || raw <= 0) return 1;
    return Math.min(MAX_AGGREGATE_STAT_BOOST, raw);
}

// Runbook steps for STAT_GAIN_MULTIPLIER used as a PACING correction (2026-10
// rebalance). The 3-point 15m session moves in whole points, so the dial is
// lumpy: +10% players' 15m seal rises at >= 1.061, +37.5% at >= 1.091, and +30%
// falls below 0.897, each handing the 96-start chain a whole point the long
// tiers do not get. Every value here keeps the archetype 15m seals unchanged
// (pinned by api/_training-parity.test.ts). The runtime never snaps to this
// list; a deliberate era change outside it is a separate owner decision.
export const STAT_GAIN_DIAL_STEPS = [0.9, 0.95, 1, 1.03, 1.06] as const;

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
