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
 * Bands (by enemy level, inclusive upper bounds):
 *   1–30  easy   · 31–50 medium · 51–90 hard · 91+ peer
 * Easy (1–30) is a PROTECTED ONBOARDING band: beyond just weaker stats, enemy
 * damage is hit-capped, turn-capped, and mercy-floored so a learning player is
 * pressured but never suddenly killed (see pveGuardedEnemyHit). Peer is "like
 * fighting another player": the ×1.3 factor pushes a high-level enemy's stats
 * toward the cap, so endgame PvE mirrors a maxed PvP fighter and is uncapped.
 *
 * The multipliers below are a STARTING curve — tune them from kill-time
 * playtests. A factor < 1 weakens the enemy (early game); > 1 strengthens it
 * (late game). Scaling stats raises both the enemy's offense AND its effective
 * defense (statFactor), so this one lever makes a fight deadlier and longer at
 * once, without touching HP-init or the shared damage math.
 */
import { MAX_STAT, JUTSU_MAX_LEVEL } from "../constants/game";
import type { Stats } from "../types/combat";

export type PveDifficultyBand = "easy" | "medium" | "hard" | "peer";

export function pveDifficultyBand(level: number): PveDifficultyBand {
    const lvl = Math.max(1, Math.floor(level || 1));
    // Inclusive upper bounds: 30 is easy, 50 is medium, 90 is hard, 91+ peer.
    if (lvl <= 30) return "easy";
    if (lvl <= 50) return "medium";
    if (lvl <= 90) return "hard";
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

// The AI's effective jutsu mastery, tied to its OWN level (a level-8 sentinel is
// not a maxed jutsu user), capped at the mastery ceiling. The PvE AI cast paths
// used to default to JUTSU_MAX_LEVEL (50) for EVERY enemy regardless of level —
// so a D-rank errand foe cast with the same EP scaling and tag% as an endgame
// boss. Routing this per the enemy's level makes the bands actually differ:
// easy/medium AIs cast under-mastered, while hard/peer (50+) reach full mastery,
// mirroring a maxed player. Combat math (calculateDamage / effectiveTagPercent)
// is unchanged — this only feeds it an honest mastery number.
export function pveAiMasteryForLevel(level: number): number {
    return Math.max(0, Math.min(JUTSU_MAX_LEVEL, Math.floor(level || 1)));
}

// Per-band ceiling on a single PvE enemy hit, as a fraction of the player's max
// HP. This is the structural guarantee that early content can't one-shot: no
// matter how the shared EP×stat damage curve scales (it was tuned for late-game
// HP pools, so raw hits dwarf a level-3's 300 HP), an enemy hit in the easy band
// is clamped to a learnable chunk of the bar. The peer band (90+) is intentionally
// UNCAPPED so endgame PvE hits as hard as a real duel. STARTING values — tune
// from kill-time playtests.
const BAND_MAX_HIT_FRACTION: Record<PveDifficultyBand, number> = {
    easy: 0.25,
    medium: 0.40,
    hard: 0.60,
    peer: Infinity,
};

// Max damage a single standard-PvE enemy hit may deal to a player with
// `playerMaxHp`, by the encounter band. Returns Infinity (no cap) for the peer
// band. Callers gate this to standard PvE only (no live opponentCharacter, not
// endless/ranked) — exactly like pveDifficultyStatMultiplier.
export function pveEnemyHitCap(level: number, playerMaxHp: number): number {
    const frac = BAND_MAX_HIT_FRACTION[pveDifficultyBand(level)];
    if (!Number.isFinite(frac)) return Infinity;
    const hp = Number.isFinite(playerMaxHp) ? Math.max(1, playerMaxHp) : 1;
    return Math.max(1, Math.floor(hp * frac));
}

// Ceiling on TOTAL damage a player takes across a single enemy turn (one or more
// chained enemy actions), as a fraction of max HP. Bounds "bad turns" so a
// multi-action enemy can't stack several capped hits into a kill. Hard has no
// per-turn cap (it expects HP management); peer is uncapped.
const BAND_MAX_TURN_FRACTION: Record<PveDifficultyBand, number> = {
    easy: 0.38,
    medium: 0.60,
    hard: Infinity,
    peer: Infinity,
};

// Below this level the easy band's mercy floor is STRONGER: the enemy cannot
// land a killing blow unless the player STARTED the turn already this low.
const EASY_LOWLEVEL_MAX = 10;
const EASY_LOWLEVEL_LETHAL_FLOOR = 0.25; // <25% HP at turn start → killable
const EASY_MERCY_HALF = 0.5;             // >50% HP at turn start → cannot die this turn

export interface PveEnemyHitGuard {
    /** The encounter's level — picks the band and the low-level rule. */
    enemyLevel: number;
    playerMaxHp: number;
    /** Player HP at the START of this enemy turn (drives the mercy floor). */
    playerHpTurnStart: number;
    /** Damage already applied to the player earlier in THIS enemy turn. */
    dealtThisTurn: number;
}

// The single clamp every standard-PvE enemy hit passes through. Folds the three
// onboarding protections together and returns the damage actually allowed:
//   1. Per-hit cap   — no single hit exceeds the band's max-hit fraction.
//   2. Per-turn cap  — cumulative damage across one enemy turn is bounded.
//   3. Mercy floor   — EASY band only: a player who STARTED the turn above half
//      HP can't be dropped below 1 this turn (no sudden death). At low levels
//      (≤10) it's stronger — the enemy can't kill unless the player started the
//      turn already below a quarter HP.
// Peer band returns the raw hit unchanged (real-duel). Hard applies only the
// per-hit cap. Callers gate this to standard PvE (no live opponentCharacter,
// not endless/ranked), exactly like the stat multiplier.
export function pveGuardedEnemyHit(rawHit: number, guard: PveEnemyHitGuard): number {
    const band = pveDifficultyBand(guard.enemyLevel);
    let hit = Math.max(0, Math.floor(Number.isFinite(rawHit) ? rawHit : 0));
    if (band === "peer") return hit;

    const maxHp = Number.isFinite(guard.playerMaxHp) ? Math.max(1, guard.playerMaxHp) : 1;
    const dealt = Math.max(0, Number.isFinite(guard.dealtThisTurn) ? guard.dealtThisTurn : 0);

    // 1. Per-hit cap.
    hit = Math.min(hit, pveEnemyHitCap(guard.enemyLevel, maxHp));

    // 2. Per-turn cap.
    const turnFrac = BAND_MAX_TURN_FRACTION[band];
    if (Number.isFinite(turnFrac)) {
        const turnBudget = Math.max(1, Math.floor(maxHp * turnFrac));
        hit = Math.min(hit, Math.max(0, turnBudget - dealt));
    }

    // 3. Mercy floor (easy band only).
    if (band === "easy") {
        const startHp = Math.max(0, Math.min(maxHp, Number.isFinite(guard.playerHpTurnStart) ? guard.playerHpTurnStart : maxHp));
        const lowLevel = Math.max(1, Math.floor(guard.enemyLevel || 1)) <= EASY_LOWLEVEL_MAX;
        const protectedStart = lowLevel
            ? startHp >= maxHp * EASY_LOWLEVEL_LETHAL_FLOOR
            : startHp > maxHp * EASY_MERCY_HALF;
        if (protectedStart) {
            // Player cannot be reduced below 1 HP across the whole turn.
            const survivableTotal = Math.max(0, startHp - 1);
            hit = Math.min(hit, Math.max(0, survivableTotal - dealt));
        }
    }
    return Math.max(0, hit);
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
