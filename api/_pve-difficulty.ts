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
 * NOT ported (deliberately):
 *  • the weekly-boss helpers (weeklyBossGuardedHit / the guard cycle). The
 *    weekly boss is a separate mode with its own server authority in
 *    api/weekly-boss.ts and is not part of this migration. Porting it here
 *    would create a second home for that mechanic.
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

export function pveDifficultyStatMultiplier(level: number): number {
    return BAND_STAT_MULTIPLIER[pveDifficultyBand(level)];
}

const BAND_HP_MULTIPLIER: Record<PveDifficultyBand, number> = {
    easy: 0.75, medium: 0.85, hard: 0.92, peer: 1.0,
};

export function pveDifficultyHpMultiplier(level: number): number {
    return BAND_HP_MULTIPLIER[pveDifficultyBand(level)];
}

/** The AI's effective jutsu mastery, tied to its OWN level and its rank cap. */
export function pveAiMasteryForLevel(level: number): number {
    return Math.max(0, Math.min(JUTSU_MAX_LEVEL, Math.floor(level || 1), jutsuLevelCapForLevel(level)));
}

const BAND_MAX_HIT_FRACTION: Record<PveDifficultyBand, number> = {
    easy: 0.20, medium: 0.30, hard: 0.45, peer: Infinity,
};

export function pveEnemyHitCap(level: number, playerMaxHp: number): number {
    const frac = BAND_MAX_HIT_FRACTION[pveDifficultyBand(level)];
    if (!Number.isFinite(frac)) return Infinity;
    const hp = Number.isFinite(playerMaxHp) ? Math.max(1, playerMaxHp) : 1;
    return Math.max(1, Math.floor(hp * frac));
}

const BAND_MAX_TURN_FRACTION: Record<PveDifficultyBand, number> = {
    easy: 0.30, medium: 0.45, hard: 0.70, peer: Infinity,
};

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
    if (band === 'peer') return hit;

    const maxHp = Number.isFinite(guard.playerMaxHp) ? Math.max(1, guard.playerMaxHp) : 1;
    const dealt = Math.max(0, Number.isFinite(guard.dealtThisTurn) ? guard.dealtThisTurn : 0);

    hit = Math.min(hit, pveEnemyHitCap(guard.enemyLevel, maxHp));

    const turnFrac = BAND_MAX_TURN_FRACTION[band];
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
