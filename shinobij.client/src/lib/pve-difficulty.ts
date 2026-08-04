/*
 * PvE difficulty curve.
 *
 * Banded by the ENCOUNTER's level (not the player's), so the felt difficulty
 * tracks story/hunt/sector progression while a maxed player revisiting low-level
 * content still steamrolls it — which is what "keep early game easy" really
 * means. Standard PvE AI fights scale the enemy's stats AND max HP by the band
 * multipliers, and clamp the enemy's per-hit / per-turn damage.
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
 * fighting another player": because aiStatsForLevel now emits the full
 * level-budget block, peer's ×1.0 already mirrors a maxed PvP fighter (uncapped).
 *
 * The multipliers below are a STARTING curve — tune them from kill-time
 * playtests. A factor < 1 weakens the enemy (early game); > 1 strengthens it
 * (late game). Two independent levers, because they answer different complaints:
 *   • the STAT multiplier scales offense + effective defense (statFactor) — but
 *     statFactor is heavily damped, so it only nudges damage a few percent;
 *   • the HP multiplier decides how many hits a foe soaks (the real "tankiness"
 *     dial), and the per-hit / per-turn caps decide how hard a hit lands.
 * The peer band (90+) is intentionally left at full strength (stats ×1.0 on the
 * full-budget base, HP ×1.0, damage uncapped): the one band "supposed to be strong".
 * The shared damage math (combat-math.ts / api/pvp/move.ts) is never touched.
 */
import { MAX_STAT, JUTSU_MAX_LEVEL, jutsuLevelCapForLevel } from "../constants/game";
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

// Retuned for the unified stat model: aiStatsForLevel now emits the FULL
// level-budget block (== a fully-allocated player at that level), so `peer` no
// longer needs a >1 boost to reach maxed-player strength — peer 1.0 IS the mirror.
// Sub-peer bands sit below 1 for a forgiving ramp (easy ≈ preserves the old
// onboarding feel once the higher base is accounted for). Kept strictly monotonic.
const BAND_STAT_MULTIPLIER: Record<PveDifficultyBand, number> = {
    easy: 0.6,
    medium: 0.75,
    hard: 0.9,
    peer: 1.0,
};

export function pveDifficultyStatMultiplier(level: number): number {
    return BAND_STAT_MULTIPLIER[pveDifficultyBand(level)];
}

// Per-band multiplier on the ENEMY'S max HP — the dominant "tankiness" lever.
// The stat multiplier above only nudges player damage (statFactor is heavily
// damped: ±100 stat ≈ ±2% damage), so HP is what actually decides how many hits
// a foe soaks. Sub-peer bands soak fewer hits; the peer band (90+) keeps its
// full HP pool so endgame PvE still reads like a real duel. Applied to standard
// PvE only (no live opponentCharacter, not endless/ranked) — exactly like the
// stat multiplier. STARTING values — tune from kill-time playtests.
const BAND_HP_MULTIPLIER: Record<PveDifficultyBand, number> = {
    easy: 0.75,
    medium: 0.85,
    hard: 0.92,
    peer: 1.0,
};

export function pveDifficultyHpMultiplier(level: number): number {
    return BAND_HP_MULTIPLIER[pveDifficultyBand(level)];
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
    // Also obey the per-rank jutsu cap (same rule players get), so a mid-band
    // enemy can't out-master its own rank — e.g. a level-29 Genin foe is capped
    // at mastery 20, not 29.
    return Math.max(0, Math.min(JUTSU_MAX_LEVEL, Math.floor(level || 1), jutsuLevelCapForLevel(level)));
}

// Per-band ceiling on a single PvE enemy hit, as a fraction of the player's max
// HP. This is the structural guarantee that early content can't one-shot: no
// matter how the shared EP×stat damage curve scales (it was tuned for late-game
// HP pools, so raw hits dwarf a level-3's 300 HP), an enemy hit in the easy band
// is clamped to a learnable chunk of the bar. The peer band (90+) is intentionally
// UNCAPPED so endgame PvE hits as hard as a real duel. STARTING values — tune
// from kill-time playtests.
const BAND_MAX_HIT_FRACTION: Record<PveDifficultyBand, number> = {
    easy: 0.20,
    medium: 0.30,
    hard: 0.45,
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
// multi-action enemy can't stack several capped hits into a kill. The hard band
// now caps the turn too (it used to be uncapped, so a two-action hard foe could
// chain ~120% of the bar into a kill — the main "they hit too hard" complaint in
// the 50–90 range); peer stays uncapped so endgame PvE plays like a real duel.
const BAND_MAX_TURN_FRACTION: Record<PveDifficultyBand, number> = {
    easy: 0.30,
    medium: 0.45,
    hard: 0.70,
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
// Peer band returns the raw hit unchanged (real-duel). Hard applies the per-hit
// and per-turn caps but no mercy floor. Callers gate this to standard PvE (no
// live opponentCharacter, not endless/ranked), exactly like the stat multiplier.
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

// ── Easy-band AI behaviour pacing (the "teach, don't ambush" policy) ────────
// In the easy band the enemy holds its heaviest jutsu for the opening rounds and
// won't deliberately pick a killing blow against a healthy player — so a new
// player gets to see the combat loop before eating a signature move. These are
// pure policy helpers; Arena applies them to its move selection.

const EASY_BURST_AP = 60;          // jutsu at/above this AP are "burst / signature"
const EASY_BURST_HOLD_BEFORE = 3;  // burst is held until this round (1-indexed turn)
const EASY_LETHAL_INTENT_FRACTION = 0.25; // AI only goes for the kill at/below this HP

// A jutsu this expensive is a heavy/signature move the easy band holds back early.
export function pveIsBurstJutsuAp(ap: number): boolean {
    return (Number.isFinite(ap) ? ap : 0) >= EASY_BURST_AP;
}

// True while an easy-band enemy should still be sitting on its burst jutsu (the
// first couple of rounds). Outside the easy band this is always false.
export function pveEasyBandHoldsBurst(enemyLevel: number, turn: number): boolean {
    if (pveDifficultyBand(enemyLevel) !== "easy") return false;
    return Math.max(1, Math.floor(turn || 1)) < EASY_BURST_HOLD_BEFORE;
}

// Whether the AI may deliberately select a LETHAL move. Always allowed outside
// the easy band; inside it, only when the player is already "very low" (so the
// easy band reads as forgiving, not as a coin-flip execution). Pairs with the
// mercy floor in pveGuardedEnemyHit, which also caps the damage itself.
export function pveEasyBandAllowsLethal(enemyLevel: number, playerHpFraction: number): boolean {
    if (pveDifficultyBand(enemyLevel) !== "easy") return true;
    const frac = Number.isFinite(playerHpFraction) ? playerHpFraction : 1;
    return frac <= EASY_LETHAL_INTENT_FRACTION;
}

// ── Band intelligence ladder (the "competence" curve) ──────────────────────
// Difficulty should differ by BEHAVIOUR across the bands, not just by stats.
// pveAiCompetence returns the per-band gates the battle AI reads to decide HOW
// hard it plays: whether it reacts to the player's buffs (Clear), cleanses its
// own debuffs, and reads the player's recent actions. The stat curve above still
// sets HOW STRONG it is; this sets HOW SMART it is. Pure data — Arena applies these.
//
// IMPORTANT: `usesSmartScorer` preserves the EXACT pre-existing threshold
// (masterAi || level >= 30) so this change does not move the basic→smart
// boundary or touch any combat number. Every other field gates NEW behaviour
// that is off in the lower bands, so onboarding (easy) is unchanged.
export interface PveAiCompetence {
    band: PveDifficultyBand;
    /** Use the multi-axis smart picker vs the basic power-sort. Unchanged threshold. */
    usesSmartScorer: boolean;
    /** Min number of active player buffs before the AI will spend a turn to Clear them. Infinity = never. */
    clearBuffThreshold: number;
    /** Min number of active debuffs on the AI before it will Cleanse itself. Infinity = never. */
    cleanseSelfThreshold: number;
    /** React to the player's recent ACTIONS (playstyle), not just current state. */
    readsBehavior: boolean;
}

export function pveAiCompetence(level: number, masterAi = false): PveAiCompetence {
    const band = pveDifficultyBand(level);
    // Preserve the historical scorer gate verbatim: smart logic at level 30+ or
    // when an admin flags the AI masterAi. (Level 30 sits in the easy band but
    // has always used the smart picker — keep it that way.)
    const usesSmartScorer = masterAi || Math.max(1, Math.floor(level || 1)) >= 30;
    switch (band) {
        case "easy":
            // Teaching mode: never strips the player's buffs or self-cleanses,
            // doesn't read playstyle.
            return { band, usesSmartScorer, clearBuffThreshold: Infinity, cleanseSelfThreshold: Infinity, readsBehavior: false };
        case "medium":
            // Competent: reacts to the player stacking buffs (2+), occasional
            // self-cleanse when heavily debuffed (3+).
            return { band, usesSmartScorer, clearBuffThreshold: 2, cleanseSelfThreshold: 3, readsBehavior: false };
        case "hard":
            // Punishing: strips any meaningful buff, cleanses at 2 debuffs, reads
            // playstyle lightly.
            return { band, usesSmartScorer, clearBuffThreshold: 1, cleanseSelfThreshold: 2, readsBehavior: true };
        case "peer":
        default:
            // Like a real maxed player: reacts aggressively and reads playstyle.
            return { band, usesSmartScorer, clearBuffThreshold: 1, cleanseSelfThreshold: 2, readsBehavior: true };
    }
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
