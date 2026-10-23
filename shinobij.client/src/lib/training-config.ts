/*
 * Stat-training config — the "two-axis" training engine.
 *
 * See docs/leveling-training-redesign-plan.md. Training grows the CHOSEN stat
 * DIRECTLY (offline-accruing), bounded by the per-rank stat cap
 * (statCapForLevel). It is the primary way stats grow; leveling raises the caps
 * and pools, and combat feeds the manual unspent-points pool.
 *
 * Rates descend with tier length (10.5 / 9 / 8.25 / 8.125 per real hour) —
 * shorter tiers pay MORE per hour, so coming back often out-earns setting one
 * 8-hour session and leaving. The server allows 96 starts/day (= 24h / 15min),
 * so any tier can cover the whole day, and chaining the short ones is meant to
 * win: 96× 15m = 288/day > 24× 1h = 216 > 6× 4h = 198 > 3× 8h = 195. Attention
 * is the thing being rewarded — do NOT flatten this table.
 *
 * Magnitude: the reference regimen (12× 1h + 1× 4h + 1× 8h, full 24h coverage)
 * gives 206 pts/day. The regular player's ~86 days to L90 is pinned by the
 * server replay in api/_progression-pacing-replay.test.ts. The server's
 * TRAINING_RATE_TABLE dial can switch new starts to LEGACY_TRAINING_TIERS; the
 * game-state frame tells this copy which table is live.
 *
 * Pure/dependency-free so it can be shared by the client screen, the server-auth
 * training endpoints (Stage 2), and the pacing sim.
 */

export type TrainingTierId = "15m" | "1h" | "4h" | "8h";

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

// Per-hour 10.5 / 9 / 8.25 / 8.125 → per full session 3 / 9 / 33 / 65.
// MIRROR: api/_training-config.ts (parity-pinned by api/_training-parity.test.ts).
export const TRAINING_TIERS: TrainingTier[] = [
    { id: "15m", label: "15 Minutes", ms: 15 * 60 * 1000,     ratePerHour: 10.5,  xp: 20,  staminaCost: 5 },
    { id: "1h",  label: "1 Hour",     ms: 60 * 60 * 1000,     ratePerHour: 9,     xp: 70,  staminaCost: 15 },
    { id: "4h",  label: "4 Hours",    ms: 4 * 60 * 60 * 1000, ratePerHour: 8.25,  xp: 220, staminaCost: 35 },
    { id: "8h",  label: "8 Hours",    ms: 8 * 60 * 60 * 1000, ratePerHour: 8.125, xp: 375, staminaCost: 60 },
];

// The pre-rebalance table (3 / 10 / 38 / 72), live only while the server's
// TRAINING_RATE_TABLE kill switch is set to 'legacy'.
export const LEGACY_TRAINING_TIERS: TrainingTier[] = [
    { id: "15m", label: "15 Minutes", ms: 15 * 60 * 1000,     ratePerHour: 10.5, xp: 20,  staminaCost: 5 },
    { id: "1h",  label: "1 Hour",     ms: 60 * 60 * 1000,     ratePerHour: 10,   xp: 70,  staminaCost: 15 },
    { id: "4h",  label: "4 Hours",    ms: 4 * 60 * 60 * 1000, ratePerHour: 9.5,  xp: 220, staminaCost: 35 },
    { id: "8h",  label: "8 Hours",    ms: 8 * 60 * 60 * 1000, ratePerHour: 9,    xp: 375, staminaCost: 60 },
];

export type TrainingRateTable = "v2" | "legacy";

export function trainingTiersFor(table: TrainingRateTable): TrainingTier[] {
    return table === "legacy" ? LEGACY_TRAINING_TIERS : TRAINING_TIERS;
}

// Mirror of api/_stat-growth.ts MAX_AGGREGATE_STAT_BOOST: the ceiling on
// (1 + training bonus%) × the era dial.
export const MAX_AGGREGATE_STAT_BOOST = 2.5;

/**
 * Direct stat-point gain for a completed (or prorated) training session.
 *   elapsedMs — real time elapsed; clamped to the tier duration (offline-safe:
 *               leaving it past the tier wastes nothing and gains nothing extra).
 *   bonusPct  — village/clan/doctrine training bonus (getTrainingXpBonus), a %.
 * Flat within a tier (linear in elapsed time); the per-hour rate carries the
 * gentle cross-tier slope. The caller still clamps the result to the per-rank
 * stat cap (never exceed the ceiling).
 */
export function trainingStatGain(tier: TrainingTier, elapsedMs: number, bonusPct = 0): number {
    const cappedMs = Math.max(0, Math.min(tier.ms, Math.floor(elapsedMs)));
    const hours = cappedMs / (60 * 60 * 1000);
    const boosted = tier.ratePerHour * hours * (1 + Math.max(0, bonusPct) / 100);
    return Math.max(0, Math.round(boosted));
}

// ── Rookie momentum (early-game level redistribution) ───────────────────────
// A multiplier on early-game stat training so the first levels arrive quickly
// without changing what a level COSTS. Level is derived from earned stat points
// and the AI opponent curve scales off level, so cheapening the level anchors
// would hand the AI a free power lead at every level; raising the early income
// instead leaves points-at-level — and therefore every combat relationship —
// untouched.
//
// Linear taper from PEAK at L1 to exactly 1.0 at ROOKIE_TAPER_END_LEVEL, and
// 1.0 forever after: it never drops below 1.0, so no player is ever slowed, and
// it is continuous so no level-up makes training feel worse.
//
// MIRROR: api/_training-config.ts — the server seals the gain, this copy only
// renders the same number on the Training screen. Parity-pinned by
// api/_training-parity.test.ts; the full rationale lives in the server copy.
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
 * What a full session seals before war morale and the boost event: the tier
 * base × min(2.5, (1 + bonus%) × era dial) × the rookie multiplier on the
 * LEDGER level, rounded once. Mirror of api/_training-config.ts
 * sealedTrainingGain, which trustedTrainingRewards seals verbatim.
 */
export function sealedTrainingGain(tier: TrainingTier, bonusPct: number, ledgerLevel: number, eraDial = 1): number {
    const dial = Number.isFinite(eraDial) && eraDial > 0 ? Math.min(MAX_AGGREGATE_STAT_BOOST, eraDial) : 1;
    const bonus = Number(bonusPct);
    const source = 1 + (Number.isFinite(bonus) ? Math.max(0, bonus) : 0) / 100;
    const boost = Math.min(MAX_AGGREGATE_STAT_BOOST, source * dial);
    return Math.max(0, Math.round(trainingStatGain(tier, tier.ms, 0) * boost * rookieStatMultiplier(ledgerLevel)));
}

/**
 * What /api/training/start seals right now: sealedTrainingGain, then village
 * war morale (rallying 1.1, Ashfall 0.95) times the boost event with the same
 * rounding as the server's applyMoraleToGain (never turns a real gain into 0).
 * Equal to the seal unless a morale or event window opens or closes between
 * render and start.
 */
export function previewTrainingGain(p: {
    tier: TrainingTier;
    bonusPct: number;
    ledgerLevel: number;
    eraDial: number;
    moraleXpMult: number;
    eventBoost: number;
}): number {
    const sealed = sealedTrainingGain(p.tier, p.bonusPct, p.ledgerLevel, p.eraDial);
    return sealed > 0 ? Math.max(1, Math.round(sealed * ((p.moraleXpMult * p.eventBoost) || 1))) : 0;
}
