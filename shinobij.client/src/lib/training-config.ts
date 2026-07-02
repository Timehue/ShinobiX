/*
 * Stat-training config — the "two-axis" training engine.
 *
 * See docs/leveling-training-redesign-plan.md. Training grows the CHOSEN stat
 * DIRECTLY (offline-accruing), bounded by the per-rank stat cap
 * (statCapForLevel). It is the primary way stats grow; leveling raises the caps
 * and pools, and combat feeds the manual unspent-points pool.
 *
 * Rates are a gentle downward slope — shorter tiers are only *slightly* more
 * efficient per hour (kept close together, ~1.15× top-to-bottom, NOT a steep
 * TNR-style curve), so no tier is a trap or a spam meta. Calibrated so a
 * dedicated daily player (~16 effective training-hours/day) fully caps a 12-stat
 * build in ~90 days: 12 × (2500 − 10) ≈ 30,000 pts ÷ (16 h/day × ~20 pts/h) ≈ 94
 * days. Longer tiers win on coverage (they run while you sleep); shorter tiers
 * win slightly on rate but can't run while away — so the two roughly balance.
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

// Per-hour rates 23/22/21/20 → per full session ≈ 6 / 22 / 84 / 160.
export const TRAINING_TIERS: TrainingTier[] = [
    { id: "15m", label: "15 Minutes", ms: 15 * 60 * 1000,     ratePerHour: 23, xp: 20,  staminaCost: 5 },
    { id: "1h",  label: "1 Hour",     ms: 60 * 60 * 1000,     ratePerHour: 22, xp: 70,  staminaCost: 15 },
    { id: "4h",  label: "4 Hours",    ms: 4 * 60 * 60 * 1000, ratePerHour: 21, xp: 220, staminaCost: 35 },
    { id: "8h",  label: "8 Hours",    ms: 8 * 60 * 60 * 1000, ratePerHour: 20, xp: 375, staminaCost: 60 },
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
