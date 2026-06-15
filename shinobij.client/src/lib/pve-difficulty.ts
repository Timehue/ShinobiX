/*
 * PvE difficulty curve.
 *
 * Banded by the ENCOUNTER's level (not the player's), so the felt difficulty
 * tracks story/hunt/sector progression while a maxed player revisiting low-level
 * content still steamrolls it — which is what "keep early game easy" really
 * means. Standard PvE AI fights scale enemy stats by the band multiplier.
 *
 * Deliberately NOT applied to:
 *   • real PvP (a live opponentCharacter) — that is the source of truth,
 *   • the endless tower (already wave-scaled), or
 *   • ranked.
 * PvP combat balance (api/pvp/move.ts) is never touched by this module.
 *
 * Bands (by enemy level):
 *   1–29  easy   · 30–49 medium · 50–89 hard · 90+ peer
 * Peer is "like fighting another player": the ×1.3 factor pushes a high-level
 * enemy's stats toward the cap, so endgame PvE mirrors a maxed PvP fighter.
 *
 * The multipliers below are a STARTING curve — tune them from kill-time
 * playtests. A factor < 1 weakens the enemy (early game); > 1 strengthens it
 * (late game). Scaling stats raises both the enemy's offense AND its effective
 * defense (statFactor), so this one lever makes a fight deadlier and longer at
 * once, without touching HP-init or the shared damage math.
 */
import { MAX_STAT } from "../constants/game";
import type { Stats } from "../types/combat";

export type PveDifficultyBand = "easy" | "medium" | "hard" | "peer";

export function pveDifficultyBand(level: number): PveDifficultyBand {
    const lvl = Math.max(1, Math.floor(level || 1));
    if (lvl < 30) return "easy";
    if (lvl < 50) return "medium";
    if (lvl < 90) return "hard";
    return "peer";
}

const BAND_STAT_MULTIPLIER: Record<PveDifficultyBand, number> = {
    easy: 0.8,
    medium: 1.0,
    hard: 1.15,
    peer: 1.3,
};

export function pveDifficultyStatMultiplier(level: number): number {
    return BAND_STAT_MULTIPLIER[pveDifficultyBand(level)];
}

// Scale every numeric combat stat by the difficulty factor, clamped to the stat
// cap so the peer band tops out at a maxed-player-like profile rather than
// overshooting. A factor of 1 returns the stats unchanged (no allocation).
export function scaleStatsForPveDifficulty(stats: Stats, factor: number): Stats {
    if (factor === 1) return stats;
    const out = { ...stats } as Stats;
    (Object.keys(out) as (keyof Stats)[]).forEach((key) => {
        const value = out[key];
        if (typeof value === "number") {
            out[key] = Math.max(0, Math.min(MAX_STAT, Math.round(value * factor))) as Stats[typeof key];
        }
    });
    return out;
}
