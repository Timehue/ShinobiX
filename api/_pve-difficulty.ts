/*
 * Server-side port of the PvE difficulty curve — step 3b of the AI-fight
 * migration (docs/runbooks/combat-mode-migration.md).
 *
 * WHY THIS EXISTS
 * `shinobij.client/src/lib/pve-difficulty.ts` had NO server counterpart at all
 * (`grep pveDifficulty api/` was empty). It is the layer that makes early PvE
 * survivable: enemy stats and HP are scaled down by band, and — the load-bearing
 * part — every enemy→player hit passes a per-hit cap, a per-turn cap and an
 * easy-band mercy floor. Routing AI fights onto the server without it would
 * make a new player's first fight far harsher than the one they play today,
 * which is the mirror image of the step-3a problem.
 *
 * Formulas, so this is a hand port with a parity sweep
 * (`scripts/pve-difficulty-parity.test.ts`), same as api/_ai-level-curves.ts.
 *
 * Source of truth: shinobij.client/src/lib/pve-difficulty.ts — mirrored
 * function-for-function, constants included. Read that file for the DESIGN
 * rationale (band intent, tuning notes); this one deliberately does not restate
 * it, so there is one place to update when the curve is tuned.
 *
 * The weekly-boss helpers ARE ported now (bottom of this file). The earlier note
 * here said they were deliberately left out because "the weekly boss is a
 * separate mode with its own server authority in api/weekly-boss.ts" — that was
 * true when the weekly boss ran on the client. It does not any more: it builds a
 * Tower session and resolves on THIS engine, so leaving them out did not keep
 * one home for the mechanic, it left the server with NO boss→player clamp and no
 * guard cycle. The boss dealt its raw stat sheet, which is a near-one-shot on a
 * 10k-HP fighter, and its signature guard-up/guard-down rounds did not exist.
 *
 * NOT ported (deliberately):
 *  • `scaleStatsForPveDifficulty`'s Stats typing nuance — the server version
 *    takes a plain record, since sealed stat blocks are already normalized.
 */
import { MAX_STAT, JUTSU_MAX_LEVEL, jutsuLevelCapForLevel } from './combat-core/formulas.js';

export type PveDifficultyBand = 'easy' | 'medium' | 'hard' | 'peer';

export function pveDifficultyBand(level: number): PveDifficultyBand {
    const lvl = Math.max(1, Math.floor(level || 1));
    if (lvl <= 30) return 'easy';
    if (lvl <= 50) return 'medium';
    if (lvl <= 90) return 'hard';
    return 'peer';
}

const BAND_STAT_MULTIPLIER: Record<PveDifficultyBand, number> = {
    easy: 0.6, medium: 0.75, hard: 0.9, peer: 1.0,
};

const PEER_FULL_POWER_LEVEL = 100;
const PEER_RAMP_START_LEVEL = 90;

function peerRamp(level: number): number {
    const lvl = Math.max(1, Math.floor(Number(level) || 1));
    return Math.max(0, Math.min(1, (lvl - PEER_RAMP_START_LEVEL) / (PEER_FULL_POWER_LEVEL - PEER_RAMP_START_LEVEL)));
}

function lerp(from: number, to: number, amount: number): number {
    return from + (to - from) * amount;
}

export function pveDifficultyStatMultiplier(level: number): number {
    const band = pveDifficultyBand(level);
    if (band !== 'peer') return BAND_STAT_MULTIPLIER[band];
    return lerp(BAND_STAT_MULTIPLIER.hard, BAND_STAT_MULTIPLIER.peer, peerRamp(level));
}

const BAND_HP_MULTIPLIER: Record<PveDifficultyBand, number> = {
    easy: 0.75, medium: 0.85, hard: 0.92, peer: 1.0,
};

export function pveDifficultyHpMultiplier(level: number): number {
    const band = pveDifficultyBand(level);
    if (band !== 'peer') return BAND_HP_MULTIPLIER[band];
    return lerp(BAND_HP_MULTIPLIER.hard, BAND_HP_MULTIPLIER.peer, peerRamp(level));
}

/** The AI's effective jutsu mastery, tied to its OWN level and its rank cap. */
export function pveAiMasteryForLevel(level: number): number {
    return Math.max(0, Math.min(JUTSU_MAX_LEVEL, Math.floor(level || 1), jutsuLevelCapForLevel(level)));
}

const BAND_MAX_HIT_FRACTION: Record<PveDifficultyBand, number> = {
    easy: 0.20, medium: 0.30, hard: 0.45, peer: Infinity,
};

const PEER_RAMP_MAX_HIT_FRACTION = 2;
const PEER_RAMP_MAX_TURN_FRACTION = 3;

function peerHitFraction(level: number): number {
    if (Math.floor(Number(level) || 1) >= PEER_FULL_POWER_LEVEL) return Infinity;
    return lerp(BAND_MAX_HIT_FRACTION.hard, PEER_RAMP_MAX_HIT_FRACTION, peerRamp(level));
}

export function pveEnemyHitCap(level: number, playerMaxHp: number): number {
    const band = pveDifficultyBand(level);
    const frac = band === 'peer' ? peerHitFraction(level) : BAND_MAX_HIT_FRACTION[band];
    if (!Number.isFinite(frac)) return Infinity;
    const hp = Number.isFinite(playerMaxHp) ? Math.max(1, playerMaxHp) : 1;
    return Math.max(1, Math.floor(hp * frac));
}

const BAND_MAX_TURN_FRACTION: Record<PveDifficultyBand, number> = {
    easy: 0.30, medium: 0.45, hard: 0.70, peer: Infinity,
};

function peerTurnFraction(level: number): number {
    if (Math.floor(Number(level) || 1) >= PEER_FULL_POWER_LEVEL) return Infinity;
    return lerp(BAND_MAX_TURN_FRACTION.hard, PEER_RAMP_MAX_TURN_FRACTION, peerRamp(level));
}

const EASY_LOWLEVEL_MAX = 10;
const EASY_LOWLEVEL_LETHAL_FLOOR = 0.25;
const EASY_MERCY_HALF = 0.5;

export interface PveEnemyHitGuard {
    enemyLevel: number;
    playerMaxHp: number;
    /** Player HP at the START of this enemy turn (drives the mercy floor). */
    playerHpTurnStart: number;
    /** Damage already applied to the player earlier in THIS enemy turn. */
    dealtThisTurn: number;
}

/**
 * The single clamp every standard-PvE enemy hit passes through: per-hit cap,
 * per-turn cap, then the easy-band mercy floor. Peer band returns the raw hit.
 * See the client module for the full rationale.
 */
export function pveGuardedEnemyHit(rawHit: number, guard: PveEnemyHitGuard): number {
    const band = pveDifficultyBand(guard.enemyLevel);
    let hit = Math.max(0, Math.floor(Number.isFinite(rawHit) ? rawHit : 0));
    if (band === 'peer' && Math.floor(Number(guard.enemyLevel) || 1) >= PEER_FULL_POWER_LEVEL) return hit;

    const maxHp = Number.isFinite(guard.playerMaxHp) ? Math.max(1, guard.playerMaxHp) : 1;
    const dealt = Math.max(0, Number.isFinite(guard.dealtThisTurn) ? guard.dealtThisTurn : 0);

    hit = Math.min(hit, pveEnemyHitCap(guard.enemyLevel, maxHp));

    const turnFrac = band === 'peer' ? peerTurnFraction(guard.enemyLevel) : BAND_MAX_TURN_FRACTION[band];
    if (Number.isFinite(turnFrac)) {
        const turnBudget = Math.max(1, Math.floor(maxHp * turnFrac));
        hit = Math.min(hit, Math.max(0, turnBudget - dealt));
    }

    if (band === 'easy') {
        const startHp = Math.max(0, Math.min(maxHp, Number.isFinite(guard.playerHpTurnStart) ? guard.playerHpTurnStart : maxHp));
        const lowLevel = Math.max(1, Math.floor(guard.enemyLevel || 1)) <= EASY_LOWLEVEL_MAX;
        const protectedStart = lowLevel
            ? startHp >= maxHp * EASY_LOWLEVEL_LETHAL_FLOOR
            : startHp > maxHp * EASY_MERCY_HALF;
        if (protectedStart) {
            const survivableTotal = Math.max(0, startHp - 1);
            hit = Math.min(hit, Math.max(0, survivableTotal - dealt));
        }
    }
    return Math.max(0, hit);
}

// ── Easy-band AI behaviour pacing ──────────────────────────────────────────
const EASY_BURST_AP = 60;
const EASY_BURST_HOLD_BEFORE = 3;
const EASY_LETHAL_INTENT_FRACTION = 0.25;

export function pveIsBurstJutsuAp(ap: number): boolean {
    return (Number.isFinite(ap) ? ap : 0) >= EASY_BURST_AP;
}

export function pveEasyBandHoldsBurst(enemyLevel: number, turn: number): boolean {
    if (pveDifficultyBand(enemyLevel) !== 'easy') return false;
    return Math.max(1, Math.floor(turn || 1)) < EASY_BURST_HOLD_BEFORE;
}

export function pveEasyBandAllowsLethal(enemyLevel: number, playerHpFraction: number): boolean {
    if (pveDifficultyBand(enemyLevel) !== 'easy') return true;
    const frac = Number.isFinite(playerHpFraction) ? playerHpFraction : 1;
    return frac <= EASY_LETHAL_INTENT_FRACTION;
}

// ── Band intelligence ladder ───────────────────────────────────────────────
export interface PveAiCompetence {
    band: PveDifficultyBand;
    usesSmartScorer: boolean;
    clearBuffThreshold: number;
    cleanseSelfThreshold: number;
    readsBehavior: boolean;
}

export function pveAiCompetence(level: number, masterAi = false): PveAiCompetence {
    const band = pveDifficultyBand(level);
    const usesSmartScorer = masterAi || Math.max(1, Math.floor(level || 1)) >= 30;
    switch (band) {
        case 'easy':
            return { band, usesSmartScorer, clearBuffThreshold: Infinity, cleanseSelfThreshold: Infinity, readsBehavior: false };
        case 'medium':
            return { band, usesSmartScorer, clearBuffThreshold: 2, cleanseSelfThreshold: 3, readsBehavior: false };
        case 'hard':
            return { band, usesSmartScorer, clearBuffThreshold: 1, cleanseSelfThreshold: 2, readsBehavior: true };
        case 'peer':
        default:
            return { band, usesSmartScorer, clearBuffThreshold: 1, cleanseSelfThreshold: 2, readsBehavior: true };
    }
}

/** Scale every numeric stat by the difficulty factor, clamped to the stat cap.
 *  A factor of exactly 1 returns the input unchanged (no allocation), matching
 *  the client's early return. */
export function scaleStatsForPveDifficulty<T extends Record<string, number>>(stats: T, factor: number): T {
    if (factor === 1) return stats;
    const out = { ...stats } as Record<string, number>;
    for (const key of Object.keys(out)) {
        const value = out[key];
        if (typeof value === 'number') {
            out[key] = Math.max(0, Math.min(MAX_STAT, Math.round(value * factor)));
        }
    }
    return out as T;
}

// ─── Weekly boss ─────────────────────────────────────────────────────────────
// A hand port of the client's weekly-boss helpers, constant-for-constant. Kept
// beside the standard band because both feed the same engine clamp, but they are
// SEPARATE mechanics — see the note at the top of this file.
//
// Source of truth for the design rationale:
// shinobij.client/src/lib/pve-difficulty.ts. Parity is asserted by
// scripts/pve-difficulty-parity.test.ts.

// Boss → player: a flat per-hit fraction of the player's max HP plus a per-TURN
// ceiling, so a chained multi-action boss turn cannot stack into a kill. On a
// 10k-HP fighter: <=800 per hit, <=1,500 per turn — many rounds of grind instead
// of the ~9k near-one-shots the raw stat sheet would otherwise deal.
export const WEEKLY_BOSS_MAX_HIT_FRACTION = 0.08;
export const WEEKLY_BOSS_MAX_TURN_FRACTION = 0.15;

// Player → boss: the guard cycle. Guarded rounds soak most of the blow; open
// rounds let the player through for bonus damage.
export const WEEKLY_BOSS_GUARD_CYCLE = 4;             // one OPEN round per this many
export const WEEKLY_BOSS_GUARDED_DAMAGE_MULT = 0.30;  // guard up: ~70% of the blow soaked
export const WEEKLY_BOSS_OPEN_DAMAGE_MULT = 2.0;      // guard down: double damage

/**
 * OPEN (guard-down) round test. Offset so turn 1 is OPEN: a strong opening hit
 * teaches the boss CAN be hurt, then the guard raises for the next CYCLE-1
 * rounds and drops again on the cycle boundary (open on 1, 5, 9, … for CYCLE=4).
 */
export function isWeeklyBossOpenRound(turn: number): boolean {
    const t = Math.max(1, Math.floor(turn || 1));
    return (t - 1) % Math.max(1, WEEKLY_BOSS_GUARD_CYCLE) === 0;
}

/** Player → boss damage multiplier for the current round. */
export function weeklyBossDamageMultiplier(turn: number): number {
    return isWeeklyBossOpenRound(turn) ? WEEKLY_BOSS_OPEN_DAMAGE_MULT : WEEKLY_BOSS_GUARDED_DAMAGE_MULT;
}

/**
 * Boss → player hit clamp. Mirrors pveGuardedEnemyHit's structure but with
 * boss-specific fractions and NO band or mercy logic — the boss is high-level
 * and must stay a grind, not become survivable. `dealtThisTurn` is the damage
 * already applied earlier in THIS enemy turn, so the per-turn ceiling bounds a
 * chained multi-action turn rather than just a single hit.
 */
export function weeklyBossGuardedHit(rawHit: number, playerMaxHp: number, dealtThisTurn: number): number {
    const hit = Math.max(0, Math.floor(Number.isFinite(rawHit) ? rawHit : 0));
    const maxHp = Number.isFinite(playerMaxHp) ? Math.max(1, playerMaxHp) : 1;
    const dealt = Math.max(0, Number.isFinite(dealtThisTurn) ? dealtThisTurn : 0);
    const perHit = Math.max(1, Math.floor(maxHp * WEEKLY_BOSS_MAX_HIT_FRACTION));
    const perTurn = Math.max(1, Math.floor(maxHp * WEEKLY_BOSS_MAX_TURN_FRACTION));
    return Math.max(0, Math.min(hit, perHit, Math.max(0, perTurn - dealt)));
}
