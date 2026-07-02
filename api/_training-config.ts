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

// Per-hour rates 23/22/21/20 → per full session ≈ 6 / 22 / 84 / 160.
export const TRAINING_TIERS: TrainingTier[] = [
    { id: '15m', label: '15 Minutes', ms: 15 * 60 * 1000,     ratePerHour: 23, xp: 20,  staminaCost: 5 },
    { id: '1h',  label: '1 Hour',     ms: 60 * 60 * 1000,     ratePerHour: 22, xp: 70,  staminaCost: 15 },
    { id: '4h',  label: '4 Hours',    ms: 4 * 60 * 60 * 1000, ratePerHour: 21, xp: 220, staminaCost: 35 },
    { id: '8h',  label: '8 Hours',    ms: 8 * 60 * 60 * 1000, ratePerHour: 20, xp: 375, staminaCost: 60 },
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
