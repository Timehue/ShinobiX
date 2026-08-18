/*
 * Stat-training config — the "two-axis" training engine.
 *
 * See docs/leveling-training-redesign-plan.md. Training grows the CHOSEN stat
 * DIRECTLY (offline-accruing), bounded by the per-rank stat cap
 * (statCapForLevel). It is the primary way stats grow; leveling raises the caps
 * and pools, and combat feeds the manual unspent-points pool.
 *
 * Rates descend with tier length (10.5 / 10 / 9.5 / 9 per real hour) — shorter
 * tiers pay MORE per hour, so coming back often out-earns setting one 8-hour
 * session and leaving. The server allows 96 starts/day (= 24h / 15min), so any
 * tier can cover the whole day, and chaining the short ones is meant to win:
 * 96× 15m = 288/day > 24× 1h = 240 > 6× 4h = 228 > 3× 8h = 216. Attention is
 * the thing being rewarded — do NOT flatten this table.
 *
 * Magnitude is set from the reference regimen (12× 1h + 1× 4h + 1× 8h = 230
 * pts/day, full 24h coverage), which fully caps a 12-stat build — 12 × (2500 −
 * 10) = 29,880 pts — in ~90 days. Lighter play scales down and the most
 * attentive scales up: 96× 15m ~74 days, reference ~90, 3× 8h ~94, 16h/day
 * ~127, one 8h session ~267.
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

// Per-hour 10.5 / 10 / 9.5 / 9 → per full session 3 / 10 / 38 / 72.
// MIRROR: api/_training-config.ts (parity-pinned by api/_training-parity.test.ts).
export const TRAINING_TIERS: TrainingTier[] = [
    { id: "15m", label: "15 Minutes", ms: 15 * 60 * 1000,     ratePerHour: 10.5, xp: 20,  staminaCost: 5 },
    { id: "1h",  label: "1 Hour",     ms: 60 * 60 * 1000,     ratePerHour: 10,   xp: 70,  staminaCost: 15 },
    { id: "4h",  label: "4 Hours",    ms: 4 * 60 * 60 * 1000, ratePerHour: 9.5,  xp: 220, staminaCost: 35 },
    { id: "8h",  label: "8 Hours",    ms: 8 * 60 * 60 * 1000, ratePerHour: 9,    xp: 375, staminaCost: 60 },
];

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
export const ROOKIE_STAT_PEAK_MULTIPLIER = 5;
export const ROOKIE_TAPER_END_LEVEL = 35;

/** Early-game stat-gain multiplier for `level`. PEAK at L1 → 1.0 at L35+. */
export function rookieStatMultiplier(level: unknown): number {
    const lvl = Math.max(1, Math.floor(Number(level) || 1));
    if (lvl >= ROOKIE_TAPER_END_LEVEL) return 1;
    const remaining = (ROOKIE_TAPER_END_LEVEL - lvl) / (ROOKIE_TAPER_END_LEVEL - 1);
    return 1 + (ROOKIE_STAT_PEAK_MULTIPLIER - 1) * remaining;
}
