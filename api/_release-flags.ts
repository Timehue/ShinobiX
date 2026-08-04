import type { CombatMissionDef } from './missions/_mission-catalog.js';

export const WEEKLY_BOSS_CLIENT_DAMAGE_DISABLED_REASON = 'weekly_boss_server_authority_required';
export const STORY_BOSS_CLIENT_TRUST_DISABLED_REASON = 'server_authoritative_story_combat_required';
export const COMBAT_MISSION_CLIENT_TRUST_DISABLED_REASON = 'server_authoritative_combat_required';
export const PLAYER_AI_IMAGE_GENERATION_DISABLED_REASON = 'player_ai_image_generation_public_beta_disabled';

export function weeklyBossClientDamageEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
    return env.ENABLE_WEEKLY_BOSS_CLIENT_DAMAGE === '1';
}

export function playerAiImageGenerationEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
    return env.ENABLE_PLAYER_AI_IMAGE_GENERATION === '1';
}

/** Emergency rollback switch for NEW pairings only. Existing timers, eggs, and
 * hatches intentionally ignore it so the switch can never trap owned pets. */
export function petBreedingStartsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
    return env.DISABLE_PET_BREEDING_STARTS !== '1';
}

/**
 * Generic AI fights on the server engine (docs/runbooks/combat-mode-migration.md).
 *
 * ON by default now that the client half (step 3d) routes AI fights to the
 * server-combat screen. `ai-fight-start` seals a real encounter and returns its
 * runId + session; the client mounts MissionArenaFight when both come back.
 *
 * Turning it OFF (`DISABLE_SERVER_AI_COMBAT=1`) is the rollback: the endpoint
 * seals nothing, returns no runId, and every launch site degrades to the local
 * Arena via its `playLocally` fallback. That degrade is exercised on every
 * fight whose opponent the catalog cannot resolve, so it is not a cold path.
 * The reward token is minted either way — sealing is purely additive.
 */
export function serverAiCombatEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
    return env.DISABLE_SERVER_AI_COMBAT !== '1';
}

/**
 * The weekly boss's own PvE clamp — 8%/hit + 15%/turn boss→player, and the
 * guard-cycle multiplier player→boss (api/_pve-difficulty.ts).
 *
 * ON by default. Both halves were client-only, so once the weekly boss moved to
 * the server engine it ran with NO boss→player ceiling — a level-100 boss's raw
 * stat sheet is a near-one-shot on a 10k-HP fighter — and with none of its
 * guard-up/guard-down texture. This is a bug fix, not a difficulty knob.
 *
 * ⚠ The two halves are a MATCHED PAIR, like the B/C difficulty pass before them:
 * the clamp alone makes the boss softer, the cycle alone makes it swingier. The
 * kill switch takes out both together rather than letting them drift apart.
 */
export function weeklyBossGuardEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
    return env.DISABLE_WEEKLY_BOSS_GUARD !== '1';
}

/** Rollback switch only: story-boss wins normally require a completed server session. */
export function clientTrustedStoryBossAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
    return env.ENABLE_CLIENT_TRUSTED_STORY_BOSS === '1';
}

export function clientTrustedCombatMissionRewardAllowed(
    def: CombatMissionDef,
    env: NodeJS.ProcessEnv = process.env,
): boolean {
    if (env.ENABLE_CLIENT_TRUSTED_COMBAT_MISSION_REWARDS === '1') return true;
    return def.min <= 5 && def.xp <= 25 && def.ryo <= 20 && def.territoryScrolls <= 1;
}

/** High-rank combat claims require the token minted from a completed server session. */
export function combatMissionClaimAuthorityAllowed(
    def: CombatMissionDef,
    tokenRecord: unknown,
    env: NodeJS.ProcessEnv = process.env,
): boolean {
    if (clientTrustedCombatMissionRewardAllowed(def, env)) return true;
    return !!tokenRecord
        && typeof tokenRecord === 'object'
        && (tokenRecord as Record<string, unknown>).authority === 'server-combat';
}
