export const COMBAT_MISSION_CLIENT_TRUST_DISABLED_REASON = 'server_authoritative_combat_required';
export const PLAYER_AI_IMAGE_GENERATION_DISABLED_REASON = 'player_ai_image_generation_public_beta_disabled';

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

/**
 * Public Village War capability means the Sector Map campaign, not the legacy
 * War Hall. The campaign ships on and has one exact emergency kill switch.
 * Deprecated ENABLE_VILLAGE_WAR values deliberately have no effect.
 */
export function villageWarMapEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
    return env.DISABLE_VILLAGE_WAR !== '1';
}

/**
 * Weekly Clan Boss operations ship on unless the exact core kill switch is set.
 * Deprecated ENABLE_CLAN_BOSS values deliberately have no effect.
 */
export function clanBossEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
    return env.DISABLE_CLAN_BOSS !== '1';
}

/** Party operations inherit the core Clan Boss switch and add a narrower rollback. */
export function clanBossPartiesEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
    return clanBossEnabled(env) && env.DISABLE_CLAN_BOSS_PARTIES !== '1';
}

/** ANBU Infiltration is independent of the Sector Map campaign and ships on. */
export function anbuInfiltrationEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
    return env.DISABLE_ANBU_INFILTRATION !== '1';
}
