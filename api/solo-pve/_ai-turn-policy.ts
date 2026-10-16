import { pveAiCompetence, type PveDifficultyBand as PveBand } from '../_pve-difficulty.js';
import type { SoloPveAction } from './_session.js';
import type { CombatStatus } from '../combat-core/types.js';

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
 * weekly boss, vault ANBU, sector garrisons) keeps the original runner byte-for-byte.
 * Village-war ANBU copies explicitly seal the same planner for tactical play.
 */
export const STANDARD_PVE_AI_POLICY = 'standard-pve-v1' as const;

/** Hosts allowed to opt into the explicitly sealed tactical planner. */
export const STANDARD_PVE_AI_KINDS: ReadonlySet<string> = new Set([
    'mission',
    'story-boss',
    'academy-spar',
    'generic-ai',
    'world-ai',
    // Explicitly sealed village-war ANBU copies use the same legal planner.
    'village-war-garrison',
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
    tier: 'novice' | 'trained' | 'tactical' | 'advanced' | 'master';
    /**
     * Keep the original end-of-turn rule (stop once fewer than 30 AP remain).
     * Easy enemies stay readable: they never chain a 20-AP follow-up.
     */
    legacyTurnEnd: boolean;
    /** Search depth, still limited by the engine's AP/resources/five-action cap. */
    lookahead: 1 | 2 | 5;
    /** First actions kept (after a one-step ranking) and scored by their best follow-up. */
    firstActionBeam: number;
    /** A deterministic resolver-call budget, never a clock-dependent cutoff. */
    maxSimulations: number;
    considersSurvival: boolean;
};

/**
 * Tactical progression is separate from the unchanged damage/onboarding guards.
 * 1-15: readable original choices; 16-35: shallow two-action combinations;
 * 36-60: two-action combinations; 61-85: positioning and survival; 86-100:
 * bounded whole-turn planning. A sealed masterAi (including final story Kage)
 * always gets the highest chooser, with exactly the same combat rules.
 */
export function enemyTurnPolicy(level: number, masterAi = false): EnemyTurnPolicy {
    const band = pveAiCompetence(level, masterAi).band;
    if (masterAi || level >= 86) return { band, tier: 'master', legacyTurnEnd: false, lookahead: 5, firstActionBeam: 6, maxSimulations: 128, considersSurvival: true };
    if (level >= 61) return { band, tier: 'advanced', legacyTurnEnd: false, lookahead: 2, firstActionBeam: 6, maxSimulations: 80, considersSurvival: true };
    if (level >= 36) return { band, tier: 'tactical', legacyTurnEnd: false, lookahead: 2, firstActionBeam: 4, maxSimulations: 64, considersSurvival: false };
    if (level >= 16) return { band, tier: 'trained', legacyTurnEnd: false, lookahead: 2, firstActionBeam: 2, maxSimulations: 40, considersSurvival: false };
    return { band, tier: 'novice', legacyTurnEnd: true, lookahead: 1, firstActionBeam: 1, maxSimulations: 24, considersSurvival: false };
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
    /** Potency/duration/context values, pending next-round effects included. */
    playerPositive: number;
    playerNegative: number;
    enemyPositive: number;
    enemyNegative: number;
    distance: number;
    /** The enemy's longest damaging reach (at least 1, the basic attack). */
    enemyReach: number;
    enemyAp?: number;
    enemyChakra?: number;
    enemyMaxChakra?: number;
    enemyStamina?: number;
    enemyMaxStamina?: number;
    /** A public basic attack preview, never a read of an unequipped/hidden kit. */
    enemyHpAfterBasic?: number;
};

/** A bounded estimate of an effect's remaining benefit, in max-HP percentage points. */
export function enemyStatusValue(status: CombatStatus, context: {
    round: number; maxHp: number; hp: number; shield: number;
    positiveCount: number; negativeCount: number;
}): number {
    if (status.rounds <= 0 || (status.inactiveRound !== undefined && status.inactiveRound <= context.round)) return 0;
    // Pending statuses are useful next round, not immediately. Do not double
    // value the retiring status underneath a deferred refresh.
    const delay = Math.max(0, (status.activeRound ?? context.round) - context.round);
    const duration = Math.min(3, status.rounds, Math.max(0, (status.inactiveRound ?? Infinity) - Math.max(context.round, status.activeRound ?? context.round)));
    const turns = duration / (1 + delay * 0.35);
    const pct = Math.max(0, Math.min(60, Number(status.percent) || 0));
    let perTurn = 0;
    switch (status.name) {
        case 'Wound': case 'Drain':
            perTurn = Math.min(20, Math.max(0, Number(status.amount) || 0) * 100 / Math.max(1, context.maxHp)); break;
        case 'Ignition': case 'Recoil': perTurn = pct * 0.12; break;
        case 'Poison': perTurn = pct * 0.4; break;
        case 'Increase Damage Given': case 'Increase Damage Taken':
        case 'Decrease Damage Given': case 'Decrease Damage Taken': perTurn = pct * 0.12; break;
        case 'Increase Generals': case 'Increase Discipline': perTurn = pct * 0.035; break;
        case 'Absorb': case 'Reflect': case 'Lifesteal': perTurn = pct * 0.10; break;
        case 'Increase Heal': perTurn = context.hp < context.maxHp ? pct * 0.025 : 0; break;
        case 'Stun': perTurn = 6; break;
        case 'Lag': case 'Overclock': perTurn = 3; break;
        case 'Bloodline Seal': case 'Elemental Seal': perTurn = 3; break;
        case 'Debuff Prevent': case 'Stun Prevent': perTurn = 1.5; break;
        case 'Buff Prevent': perTurn = 1; break;
        case 'Cleanse Prevent': perTurn = context.negativeCount > 1 ? 2 : 0.25; break;
        case 'Clear Prevent': perTurn = context.positiveCount > 1 || context.shield > 0 ? 2 : 0.25; break;
        default: perTurn = 0;
    }
    return turns * perTurn;
}

/**
 * How good a state is for the enemy, relative to the start of the decision.
 * Measured in "percent of a max-HP bar": damage the player took (HP + shield),
 * vitality the enemy kept (weighted up as it gets hurt), status swings, reach.
 * Only relative order matters; the numbers are never applied to combat.
 */
export function enemyTurnValue(start: EnemyTurnSnapshot, end: EnemyTurnSnapshot): number {
    const playerMax = Math.max(1, start.playerMaxHp);
    const enemyMax = Math.max(1, start.enemyMaxHp);
    const dealt = start.playerHp - end.playerHp + 0.75 * (start.playerShield - end.playerShield);
    const kept = end.enemyHp - start.enemyHp + 0.65 * (end.enemyShield - start.enemyShield);
    const enemyHpFraction = start.enemyHp / enemyMax;
    const keepWeight = enemyHpFraction < 0.35 ? 1.1 : enemyHpFraction < 0.6 ? 0.8 : 0.45;
    let value = dealt * 100 / playerMax + kept * 100 * keepWeight / enemyMax;
    // Statuses: a debuff on the player or a buff on the enemy pays off over the
    // coming rounds (tags start next round), a removed one likewise.
    value += end.playerNegative - start.playerNegative;
    value += start.playerPositive - end.playerPositive;
    value += end.enemyPositive - start.enemyPositive;
    value += start.enemyNegative - end.enemyNegative;
    if (end.playerHp <= 0) value += 2_000;
    if (end.enemyHp <= 0) value -= 2_000;
    // A delayed Reflect/Absorb is not death prevention. Prefer a legal finisher,
    // an immediate heal/shield, or a useful retreat when a basic would kill us.
    if (end.playerHp > 0 && end.enemyHp > 0 && end.enemyHpAfterBasic !== undefined) {
        if (end.enemyHpAfterBasic <= 0) value -= 500;
        else if (end.enemyHpAfterBasic < enemyMax * 0.1) value -= 8 * (1 - end.enemyHpAfterBasic / (enemyMax * 0.1));
    }
    // Compare positioning to the starting state so a pointless lateral Flicker
    // has zero benefit. AP has a tiny opportunity cost: do not spend it on a no-op.
    value += 1.5 * (Math.max(0, start.distance - start.enemyReach) - Math.max(0, end.distance - end.enemyReach));
    value -= 0.005 * Math.max(0, (start.enemyAp ?? 0) - (end.enemyAp ?? 0));
    value -= 2 * Math.max(0, (start.enemyChakra ?? 0) - (end.enemyChakra ?? 0)) / Math.max(1, start.enemyMaxChakra ?? 1);
    value -= 2 * Math.max(0, (start.enemyStamina ?? 0) - (end.enemyStamina ?? 0)) / Math.max(1, start.enemyMaxStamina ?? 1);
    return value;
}
