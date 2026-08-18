/*
 * Server mirror of shinobij.client/src/lib/training-config.ts — the two-axis stat
 * training tiers + gain formula. Kept in lock-step with the client copy so
 * /api/training/start seals the SAME gain the client shows and applies. Pinned by
 * api/_training-parity.test.ts. See docs/leveling-training-redesign-plan.md.
 */

export type TrainingTierId = '15m' | '1h' | '4h' | '8h';

export interface TrainingTier {
    id: TrainingTierId;
    label: string;
    ms: number;
    /** Base stat points earned per real HOUR, before the village training bonus. */
    ratePerHour: number;
    /** Modest XP trickle (Axis A). Combat/missions stay the primary XP source. */
    xp: number;
    staminaCost: number;
}

// ── Rate calibration (owner-set 2026-08-17) ────────────────────────────────
// Per-hour rates 10.5 / 10 / 9.5 / 9 → per full session 3 / 10 / 38 / 72.
//
// THE SLOPE IS THE POINT. Shorter tiers pay more per hour, so a player willing
// to come back often out-earns one who sets an 8-hour session and leaves. Since
// MAX_TRAINING_STARTS_PER_DAY is 96 (= 24h / 15min), a player CAN cover the
// whole day at any tier, and chaining the short ones is meant to win:
//
//     96x 15m = 288/day  >  24x 1h = 240  >  6x 4h = 228  >  3x 8h = 216
//
// That ordering is deliberate and is asserted by the colocated tests — attention
// is the thing being rewarded. Do NOT flatten these rates to "balance" the
// tiers; a flat table silently deletes the reason short tiers exist.
//
// Magnitude is set from the owner's reference regimen: 12x 1h + 1x 4h + 1x 8h
// (full 24h coverage, 230 pts/day) fully caps a 12-stat build — 12 x (2500-10)
// = 29,880 points — in ~90 days. The old 23/22/21/20 table was calibrated
// against an assumed ~16 training-hours/day and so overshot badly once 24h
// coverage was accounted for: the same regimen capped in ~45 days.
//
// Coverage sets the pace, so lighter play scales down proportionally, and the
// most attentive play scales up: 96x 15m ~74 days, the reference ~90, 3x 8h
// ~94, 16h/day ~127, one 8h session ~267. Measured end-to-end through the real
// grant path (rookie curve + daily checklist included), not closed-form.
//
// TUNABLE: scale the whole table to move the pace; keep it strictly descending
// to keep the engagement reward. MIRROR: shinobij.client/src/lib/training-config.ts
// (parity-pinned by api/_training-parity.test.ts).
export const TRAINING_TIERS: TrainingTier[] = [
    { id: '15m', label: '15 Minutes', ms: 15 * 60 * 1000,     ratePerHour: 10.5, xp: 20,  staminaCost: 5 },
    { id: '1h',  label: '1 Hour',     ms: 60 * 60 * 1000,     ratePerHour: 10,   xp: 70,  staminaCost: 15 },
    { id: '4h',  label: '4 Hours',    ms: 4 * 60 * 60 * 1000, ratePerHour: 9.5,  xp: 220, staminaCost: 35 },
    { id: '8h',  label: '8 Hours',    ms: 8 * 60 * 60 * 1000, ratePerHour: 9,    xp: 375, staminaCost: 60 },
];

// Direct stat-point gain for a completed (or prorated) training session. Flat
// within a tier (linear in elapsed time); the per-hour rate carries the gentle
// cross-tier slope. Offline-safe: elapsed is clamped to the tier duration.
export function trainingStatGain(tier: TrainingTier, elapsedMs: number, bonusPct = 0): number {
    const cappedMs = Math.max(0, Math.min(tier.ms, Math.floor(elapsedMs)));
    const hours = cappedMs / (60 * 60 * 1000);
    const boosted = tier.ratePerHour * hours * (1 + Math.max(0, bonusPct) / 100);
    return Math.max(0, Math.round(boosted));
}

// ── Rookie momentum (early-game level redistribution) ───────────────────────
// Early levels arrive far too slowly relative to how long the whole climb takes:
// on the reference "engaged" activity profile (one 8h + one 4h session/day plus
// most dailies) L10 took 7 days and L30 took 22, against ~106 days to fully cap
// a 12-stat build. This multiplier moves that time to the front WITHOUT touching
// LEVEL_EARNED_ANCHORS.
//
// WHY THE INCOME AND NOT THE PRICE. Level is derived from earned stat points
// (api/_xp-engine.ts), and the AI opponent curve is a SEPARATE linear ramp in
// level (api/_ai-level-curves.ts aiStatBudgetForLevel) which every PvE system
// re-levels to the player. Cheapening the anchors would therefore hand the AI a
// free power lead at every level — at a front-loaded L10 the AI budget/player
// points ratio goes from 1.52x to 6.8x, a game-wide PvE regression. Raising the
// early INCOME instead leaves points-at-level exactly as they were, so the AI
// ratio, the per-rank stat caps, the HP/chakra/stamina pools and every PvP
// relationship are unchanged by construction.
//
// Shape: linear taper from PEAK at L1 to exactly 1.0 at ROOKIE_TAPER_END_LEVEL,
// and 1.0 forever after — it never drops below 1.0, so no existing player is
// slowed. Continuous, so no level-up ever makes training feel worse.
//
// Measured on the reference profile: L10 ~2 days, L30 ~8 days, full 12-stat cap
// ~90 days (was 7 / 22 / 106).
//
// SAFE BY CONSTRUCTION: the input is the SERVER-derived level, which is a pure
// function of the entitlement-conserved stat ledger (applyDerivedLevel). A
// client cannot claim a low level to farm the bonus, because holding a low level
// means genuinely holding few points. Rise-only leveling also means an
// unmigrated save reads HIGHER, which lands on the smaller multiplier.
//
// TUNABLE: PEAK is the dial. 4 → L30 in ~11 days and cap ~94; 6 → ~7 and ~87.
// MIRROR: shinobij.client/src/lib/training-config.ts (parity-pinned by
// api/_training-parity.test.ts).
export const ROOKIE_STAT_PEAK_MULTIPLIER = 5;
export const ROOKIE_TAPER_END_LEVEL = 35;

/** Early-game stat-gain multiplier for `level`. PEAK at L1 → 1.0 at L35+. */
export function rookieStatMultiplier(level: unknown): number {
    const lvl = Math.max(1, Math.floor(Number(level) || 1));
    if (lvl >= ROOKIE_TAPER_END_LEVEL) return 1;
    const remaining = (ROOKIE_TAPER_END_LEVEL - lvl) / (ROOKIE_TAPER_END_LEVEL - 1);
    return 1 + (ROOKIE_STAT_PEAK_MULTIPLIER - 1) * remaining;
}
