/*
 * Server mirror of shinobij.client/src/lib/training-config.ts — the two-axis stat
 * training tiers + gain formula. Kept in lock-step with the client copy so
 * /api/training/start seals the SAME gain the client shows and applies. Pinned by
 * api/_training-parity.test.ts. See docs/leveling-training-redesign-plan.md.
 */
import { MAX_AGGREGATE_STAT_BOOST } from './_stat-growth.js';

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

// ── Rate calibration (slope owner-set 2026-08-17; magnitude 2026-10 rebalance)
// Per-hour rates 10.5 / 9 / 8.25 / 8.125 → per full session 3 / 9 / 33 / 65.
//
// THE SLOPE IS THE POINT. Shorter tiers pay more per hour, so a player willing
// to come back often out-earns one who sets an 8-hour session and leaves. Since
// MAX_TRAINING_STARTS_PER_DAY is 96 (= 24h / 15min), a player CAN cover the
// whole day at any tier, and chaining the short ones is meant to win:
//
//     96x 15m = 288/day  >  24x 1h = 216  >  6x 4h = 198  >  3x 8h = 195
//
// That ordering is deliberate and is asserted by the colocated tests — attention
// is the thing being rewarded. Do NOT flatten these rates to "balance" the
// tiers; a flat table silently deletes the reason short tiers exist. The payoff
// for 96 clicks stays modest: 288 / 195 = 1.48, under the owner's 1.5x pin. The
// 15m tier must stay at 3 (2 would give 192 < 216 and invert the ordering).
//
// Magnitude: the reference regimen 12x 1h + 1x 4h + 1x 8h (full 24h coverage)
// gives 206 pts/day, between 3x 8h and full 15m chaining. The regular player
// (8h + 3x 4h, +10% bonus, framework regular routine) reaches L90 about 86
// days after the Academy; that pace is pinned by a day-stepped replay over the
// real grant functions in api/_progression-pacing-replay.test.ts.
//
// TUNABLE: scale the whole table to move the pace; keep it strictly descending
// to keep the engagement reward. MIRROR: shinobij.client/src/lib/training-config.ts
// (parity-pinned by api/_training-parity.test.ts).
// KILL SWITCH: TRAINING_RATE_TABLE=legacy (trainingRateTable below) restores
// LEGACY_TRAINING_TIERS for NEW starts; running sessions keep their sealed gain.
export const TRAINING_TIERS: TrainingTier[] = [
    { id: '15m', label: '15 Minutes', ms: 15 * 60 * 1000,     ratePerHour: 10.5,  xp: 20,  staminaCost: 5 },
    { id: '1h',  label: '1 Hour',     ms: 60 * 60 * 1000,     ratePerHour: 9,     xp: 70,  staminaCost: 15 },
    { id: '4h',  label: '4 Hours',    ms: 4 * 60 * 60 * 1000, ratePerHour: 8.25,  xp: 220, staminaCost: 35 },
    { id: '8h',  label: '8 Hours',    ms: 8 * 60 * 60 * 1000, ratePerHour: 8.125, xp: 375, staminaCost: 60 },
];

// The pre-rebalance table (10.5 / 10 / 9.5 / 9 → 3 / 10 / 38 / 72), kept only as
// the kill-switch value. Same slope rules; also pinned by the colocated tests.
export const LEGACY_TRAINING_TIERS: TrainingTier[] = [
    { id: '15m', label: '15 Minutes', ms: 15 * 60 * 1000,     ratePerHour: 10.5, xp: 20,  staminaCost: 5 },
    { id: '1h',  label: '1 Hour',     ms: 60 * 60 * 1000,     ratePerHour: 10,   xp: 70,  staminaCost: 15 },
    { id: '4h',  label: '4 Hours',    ms: 4 * 60 * 60 * 1000, ratePerHour: 9.5,  xp: 220, staminaCost: 35 },
    { id: '8h',  label: '8 Hours',    ms: 8 * 60 * 60 * 1000, ratePerHour: 9,    xp: 375, staminaCost: 60 },
];

export type TrainingRateTable = 'v2' | 'legacy';

export function trainingTiersFor(table: TrainingRateTable): TrainingTier[] {
    return table === 'legacy' ? LEGACY_TRAINING_TIERS : TRAINING_TIERS;
}

/**
 * Economy dial TRAINING_RATE_TABLE (framework 8.3): 'v2' (default) or 'legacy'.
 * Anything else reads as 'v2', so a typo can never switch tables. Read at call
 * time, so a Railway variable flip reaches the next start without a rebuild.
 */
export function trainingRateTable(): TrainingRateTable {
    return String(process.env.TRAINING_RATE_TABLE ?? '').trim().toLowerCase() === 'legacy' ? 'legacy' : 'v2';
}

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
// a 12-stat build. This multiplier moves that time to the front while the
// stat-derived level curve independently sets the gradually rising thresholds.
//
// Level is derived from earned stat points (api/_xp-engine.ts), while the AI
// opponent stat curve is a separate frozen linear ramp. The progressive curve
// keeps the first-session Level 10 threshold at 1,800 and stays close to the
// prior rank checkpoints, so the tutorial can accelerate new players without
// changing the shipped AI stat blocks or stat caps.
//
// Shape: linear taper from PEAK at L1 to exactly 1.0 at ROOKIE_TAPER_END_LEVEL,
// and 1.0 forever after — it never drops below 1.0, so no existing player is
// slowed. Continuous, so no level-up ever makes training feel worse.
//
// With PEAK 6, the reference profile reaches L30 in ~7 days and the full
// 12-stat cap in ~87 days. PEAK 5 was ~8 / 90; this pass moves early growth
// forward while the higher L100 threshold makes the final levels take longer.
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
export const ROOKIE_STAT_PEAK_MULTIPLIER = 6;
export const ROOKIE_TAPER_END_LEVEL = 35;

/** Early-game stat-gain multiplier for `level`. PEAK at L1 → 1.0 at L35+. */
export function rookieStatMultiplier(level: unknown): number {
    const lvl = Math.max(1, Math.floor(Number(level) || 1));
    if (lvl >= ROOKIE_TAPER_END_LEVEL) return 1;
    const remaining = (ROOKIE_TAPER_END_LEVEL - lvl) / (ROOKIE_TAPER_END_LEVEL - 1);
    return 1 + (ROOKIE_STAT_PEAK_MULTIPLIER - 1) * remaining;
}

/**
 * The stat gain a full session seals before war morale and the boost event:
 * the tier base × min(2.5, (1 + bonus%) × era dial) × the rookie multiplier on
 * the ledger level, rounded once. trustedTrainingRewards seals exactly this, and
 * the client copy previews it with the dial from the game-state frame, so the
 * preview cannot round in a different order than the seal.
 */
export function sealedTrainingGain(tier: TrainingTier, bonusPct: number, ledgerLevel: number, eraDial = 1): number {
    const dial = Number.isFinite(eraDial) && eraDial > 0 ? Math.min(MAX_AGGREGATE_STAT_BOOST, eraDial) : 1;
    const bonus = Number(bonusPct);
    const source = 1 + (Number.isFinite(bonus) ? Math.max(0, bonus) : 0) / 100;
    const boost = Math.min(MAX_AGGREGATE_STAT_BOOST, source * dial);
    return Math.max(0, Math.round(trainingStatGain(tier, tier.ms, 0) * boost * rookieStatMultiplier(ledgerLevel)));
}
