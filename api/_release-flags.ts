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

/**
 * Server-enforced PvP turn expiry (api/pvp/_turn-deadline.ts). Default ON —
 * a closed tab must never freeze a live match. The opt-out exists for test
 * harnesses that hold a turn idle on purpose (the combat-layout viewport
 * matrix captures ten viewports of one open turn); never set it in prod.
 */
export function pvpTurnDeadlineEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
    return env.DISABLE_PVP_TURN_DEADLINE !== '1';
}

/**
 * Sector Contracts: the day's posted work on a handful of wild sectors, and the
 * bounty for finishing it. Ships ON, and is expected to STAY on.
 *
 * DISABLE_SECTOR_CONTRACTS is an INCIDENT VALVE, not a content toggle — owner
 * ruling 2026-08-26: game features are not turned off. It exists for one
 * situation only: the claim pays ryo, and if that ever pays wrongly the
 * alternative to an env var is shipping a deploy while it mints. Do not reach
 * for it to hide, stage or A/B this feature.
 *
 * When set, the route 404s, the explore hook stops crediting progress, and every
 * read answers "no contract", so the surface disappears cleanly instead of
 * stranding half-finished work; progress rows then expire on their own TTL. The
 * client latches the first 404 (lib/sector-contract) so the world map stops
 * marking a board the server will not honour.
 */
export function sectorContractsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
    return env.DISABLE_SECTOR_CONTRACTS !== '1';
}
/**
 * Village Stores (Provisions + Materials): the ration cook recipes, donation
 * routing, daily spoil/burn/convert pass, garrison-feed toggle, and the
 * materials gate on structure levels 6–10. Default ON; the exact kill switch
 * turns every new path into a no-op / 404 and the daily pass skips stores.
 */
export function villageStoresEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
    return env.DISABLE_VILLAGE_STORES !== '1';
}
