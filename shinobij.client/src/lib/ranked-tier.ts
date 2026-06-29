/*
 * Ranked-tier mapping — turns a bare Elo number (rankedRating, default 1000)
 * into a named, colored tier so ranked standing reads as *status* the player
 * can recognise and chase, not an opaque integer. Pure + IO-free; the badge
 * component (components/RankBadge.tsx) and any leaderboard surface read from
 * here so the ladder is defined in exactly one place.
 *
 * Presentation only — this never touches matchmaking or the Elo math in
 * api/_ranked-rating.ts / lib/progression.ts.
 */

export interface RankTier {
    key: string;
    /** Display name shown on the badge. */
    name: string;
    /** Inclusive lower bound of the tier (ascending). */
    min: number;
    /** Accent color (hex) for the badge text/border/background tint. */
    color: string;
}

// A 7-rung ladder on a SEPARATE axis from the village career rank. It deliberately
// avoids the career/role vocabulary (Genin/Chūnin/Jōnin/Anbu/Sannin and especially
// Kage — a single reserved title held by the duel-won village leader): a ranked
// tier is your *dueling skill*, not your in-world office, so reusing those words
// would be wrong (you can't have many "Kages"). The default unrated player (1000)
// starts at Adept and climbs to Legend.
export const RANK_TIERS: readonly RankTier[] = [
    { key: 'novice',      name: 'Novice',      min: 0,    color: '#94a3b8' },
    { key: 'adept',       name: 'Adept',       min: 1000, color: '#4ade80' },
    { key: 'veteran',     name: 'Veteran',     min: 1150, color: '#38bdf8' },
    { key: 'expert',      name: 'Expert',      min: 1300, color: '#a78bfa' },
    { key: 'master',      name: 'Master',      min: 1450, color: '#f87171' },
    { key: 'grandmaster', name: 'Grandmaster', min: 1650, color: '#fbbf24' },
    { key: 'legend',      name: 'Legend',      min: 1850, color: '#fb923c' },
] as const;

/** Map a rating to its tier (the highest tier whose `min` it meets). */
export function eloTier(rating: number): RankTier {
    const r = Number.isFinite(rating) ? rating : 1000;
    let tier: RankTier = RANK_TIERS[0];
    for (const t of RANK_TIERS) {
        if (r >= t.min) tier = t; else break;
    }
    return tier;
}

/**
 * Tier + progress toward the next tier, for an optional progress bar.
 * `pct` is 0–100; `next` is null at the top tier (Kage-class).
 */
export function rankTierProgress(rating: number): { tier: RankTier; next: RankTier | null; pct: number } {
    const r = Number.isFinite(rating) ? rating : 1000;
    const idx = RANK_TIERS.reduce((acc, t, i) => (r >= t.min ? i : acc), 0);
    const tier = RANK_TIERS[idx];
    const next = idx < RANK_TIERS.length - 1 ? RANK_TIERS[idx + 1] : null;
    if (!next) return { tier, next: null, pct: 100 };
    const span = next.min - tier.min;
    const pct = span > 0 ? Math.max(0, Math.min(100, Math.round(((r - tier.min) / span) * 100))) : 0;
    return { tier, next, pct };
}
