/*
 * rank-progression — the player-facing view of the ninja-rank ladder and the
 * per-rank combat stat cap (the "anti-twink" clamp). Pure data + helpers, no
 * React, so the legibility panel (ProgressionPanel) and the rank-up celebration
 * (RankUpCelebration) share ONE source of truth and stay consistent with the
 * combat engine.
 *
 * The bands MUST mirror rankFromLevel (lib/stats.ts) and statCapForLevel
 * (constants/game.ts) — both keyed off the same level thresholds (15/30/50/80).
 * rank-progression.test.ts pins that they never drift.
 */
import {
    STAT_CAP_ACADEMY,
    STAT_CAP_GENIN,
    STAT_CAP_CHUNIN,
    STAT_CAP_JONIN,
    STAT_CAP_SPECIAL_JONIN,
    STAT_CAP_FIELDS,
    statCapForLevel,
} from "../constants/game";

export type RankBand = {
    /** 0-based ladder position (Academy = 0 … Special Jonin = 4). */
    index: number;
    /** Display name — matches rankFromLevel(minLevel) exactly. */
    rank: string;
    /** First level at which a fighter holds this rank. */
    minLevel: number;
    /** The combat stat cap applied while at this rank (anti-twink clamp). */
    statCap: number;
};

// Newest-first would be confusing here; keep ascending by rank.
export const RANK_BANDS: RankBand[] = [
    { index: 0, rank: "Academy Student", minLevel: 1, statCap: STAT_CAP_ACADEMY },
    { index: 1, rank: "Genin", minLevel: 15, statCap: STAT_CAP_GENIN },
    { index: 2, rank: "Chunin", minLevel: 30, statCap: STAT_CAP_CHUNIN },
    { index: 3, rank: "Jonin", minLevel: 50, statCap: STAT_CAP_JONIN },
    { index: 4, rank: "Special Jonin", minLevel: 80, statCap: STAT_CAP_SPECIAL_JONIN },
];

/** Ladder position for a level — mirrors rankFromLevel's thresholds. */
export function rankBandIndexForLevel(level: number): number {
    const lvl = Math.max(1, Math.floor(Number(level) || 1));
    if (lvl >= 80) return 4;
    if (lvl >= 50) return 3;
    if (lvl >= 30) return 2;
    if (lvl >= 15) return 1;
    return 0;
}

export function rankBandForLevel(level: number): RankBand {
    return RANK_BANDS[rankBandIndexForLevel(level)];
}

/** The next rank up, or null at Special Jonin (the top band). */
export function nextRankBand(level: number): RankBand | null {
    const idx = rankBandIndexForLevel(level);
    return idx >= RANK_BANDS.length - 1 ? null : RANK_BANDS[idx + 1];
}

/**
 * How many of the 12 combat stats are currently being clamped by the rank cap —
 * i.e. stored above the rank's combat ceiling. Drives the "some stats are held
 * back until you rank up" hint that makes the otherwise-invisible clamp legible.
 * Special Jonin's cap equals MAX_STAT, so this is always 0 at the top band.
 */
export function cappedStatCount(stats: Record<string, number> | undefined, level: number): number {
    if (!stats) return 0;
    const cap = statCapForLevel(level);
    let n = 0;
    for (const k of STAT_CAP_FIELDS) {
        const v = stats[k];
        if (typeof v === "number" && v > cap) n += 1;
    }
    return n;
}
