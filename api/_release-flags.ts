export const WEEKLY_BOSS_CLIENT_DAMAGE_DISABLED_REASON = 'weekly_boss_server_authority_required';
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

/** The weekly boss's paired PvE clamp and guard-cycle switch. */
export function weeklyBossGuardEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
    return env.DISABLE_WEEKLY_BOSS_GUARD !== '1';
}
