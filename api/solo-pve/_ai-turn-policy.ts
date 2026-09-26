import { pveAiCompetence, type PveDifficultyBand as PveBand } from '../_pve-difficulty.js';
import type { SoloPveAction } from './_session.js';

/*
 * Standard-PvE enemy turn policy (docs/pve-ai.md). Pure: no IO, no clock, no
 * randomness. The Solo-PvE engine (./_engine.ts) owns the turn loop and every
 * rule of combat; this module only decides HOW WELL an enemy chooses among the
 * actions the engine would accept, by difficulty bracket.
 *
 * Nothing here changes a number the engine uses: AP costs, damage, tags,
 * cooldowns, stats and the per-hit / per-turn caps all come from the same
 * resolver a player's action goes through. A higher bracket gets a better
 * CHOOSER, never a stronger fighter.
 */

/**
 * The seal that opts an encounter into this policy. Stamped on the enemy
 * character when the session is built (./_ai-encounter.ts), exactly like
 * `missionTactics`, so a session keeps the runner it started with and every
 * other Solo host (Hollow Gate, endless waves, caravan, stronghold patrols,
 * weekly boss, ANBU, garrisons) keeps the original runner byte-for-byte.
 */
export const STANDARD_PVE_AI_POLICY = 'standard-pve-v1' as const;

/** The standard-PvE encounter kinds (shared/runtime-mode-registry.ts). */
export const STANDARD_PVE_AI_KINDS: ReadonlySet<string> = new Set([
    'mission',
    'story-boss',
    'academy-spar',
    'generic-ai',
    'world-ai',
]);

/** Emergency rollback: every session falls back to the original runner. */
export function standardPveAiPlannerDisabled(env: NodeJS.ProcessEnv = process.env): boolean {
    return env.DISABLE_PVE_AI_PLANNER === '1';
}

export function standardPvePlannerApplies(input: {
    policy: unknown;
    kind: string;
    missionTactics: boolean;
    weeklyBoss: boolean;
    env?: NodeJS.ProcessEnv;
}): boolean {
    if (standardPveAiPlannerDisabled(input.env)) return false;
    if (input.policy !== STANDARD_PVE_AI_POLICY) return false;
    if (!STANDARD_PVE_AI_KINDS.has(input.kind)) return false;
    // A weekly-boss guard is never standard PvE, whatever the kind says.
    if (input.weeklyBoss) return false;
    // The four authored mission kits keep their own scripted runner.
    if (input.missionTactics) return false;
    return true;
}

export type EnemyTurnPolicy = {
    band: PveBand;
    /**
     * Keep the original end-of-turn rule (stop once fewer than 30 AP remain).
     * Easy enemies stay readable: they never chain a 20-AP follow-up.
     */
    legacyTurnEnd: boolean;
    /** 1: take the best-scored legal action. 2: pick the best two-action combination's first step. */
    lookahead: 1 | 2;
    /** First actions kept (after a one-step ranking) and scored by their best follow-up. */
    firstActionBeam: number;
};

/**
 * The bracket policy. Same bands as the difficulty guard (_pve-difficulty.ts):
 *   easy  (1-30)   readable: original priority order and turn end, legal actions only
 *   medium(31-50)  spends its whole turn: keeps acting while a legal action exists
 *   hard  (51-90)  plans two-action combinations (e.g. a 40-AP setup + 60-AP hit)
 *   peer  (91+)    the same planner (the band already removes the damage guard)
 * An admin `masterAi` profile plans at any level, matching the smart scorer.
 */
export function enemyTurnPolicy(level: number, masterAi = false): EnemyTurnPolicy {
    const band = pveAiCompetence(level, masterAi).band;
    if (masterAi || band === 'hard' || band === 'peer') {
        return { band, legacyTurnEnd: false, lookahead: 2, firstActionBeam: 6 };
    }
    if (band === 'medium') return { band, legacyTurnEnd: false, lookahead: 1, firstActionBeam: 1 };
    return { band, legacyTurnEnd: true, lookahead: 1, firstActionBeam: 1 };
}

/** A stable, total order over actions, for deterministic tie-breaks. */
export function enemyActionKey(action: SoloPveAction): string {
    switch (action.type) {
        case 'jutsu': return `jutsu:${action.jutsuId}:${action.tile ?? ''}`;
        case 'move': return `move:${String(action.tile).padStart(4, '0')}`;
        default: return action.type;
    }
}

/** What an evaluation needs from a board state. Built by the engine. */
export type EnemyTurnSnapshot = {
    playerHp: number;
    playerShield: number;
    playerMaxHp: number;
    enemyHp: number;
    enemyShield: number;
    enemyMaxHp: number;
    /** Status counts by kind, pending (next-round) ones included. */
    playerPositive: number;
    playerNegative: number;
    enemyPositive: number;
    enemyNegative: number;
    distance: number;
    /** The enemy's longest damaging reach (at least 1, the basic attack). */
    enemyReach: number;
};

/**
 * How good a state is for the enemy, relative to the start of the decision.
 * Measured in "percent of a max-HP bar": damage the player took (HP + shield),
 * vitality the enemy kept (weighted up as it gets hurt), status swings, reach.
 * Only relative order matters; the numbers are never applied to combat.
 */
export function enemyTurnValue(start: EnemyTurnSnapshot, end: EnemyTurnSnapshot): number {
    const playerMax = Math.max(1, start.playerMaxHp);
    const enemyMax = Math.max(1, start.enemyMaxHp);
    const dealt = (start.playerHp + start.playerShield) - (end.playerHp + end.playerShield);
    const kept = (end.enemyHp + end.enemyShield) - (start.enemyHp + start.enemyShield);
    const enemyHpFraction = start.enemyHp / enemyMax;
    const keepWeight = enemyHpFraction < 0.35 ? 1.1 : enemyHpFraction < 0.6 ? 0.8 : 0.45;
    let value = dealt * 100 / playerMax + kept * 100 * keepWeight / enemyMax;
    // Statuses: a debuff on the player or a buff on the enemy pays off over the
    // coming rounds (tags start next round), a removed one likewise.
    value += 10 * Math.max(0, end.playerNegative - start.playerNegative);
    value += 8 * Math.max(0, start.playerPositive - end.playerPositive);
    value += 8 * Math.max(0, end.enemyPositive - start.enemyPositive);
    value += 10 * Math.max(0, start.enemyNegative - end.enemyNegative);
    if (end.playerHp <= 0) value += 1_000;
    if (end.enemyHp <= 0) value -= 1_000;
    // Ending out of reach wastes the next turn's opening.
    value -= 1.5 * Math.max(0, end.distance - end.enemyReach);
    return value;
}
