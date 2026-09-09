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

/**
 * Hospital discharge restores HP ONLY, not chakra and stamina (MMORPG behavior
 * audit F1, 2026-09-08). Default ON.
 *
 * Why: at level 100 the pools are 10,000 each (HP_CAP / CHAKRA_CAP_V2 /
 * STAMINA_CAP_V2) while idle regeneration ran at a flat 1 point per second, so
 * a discharge handed back up to 30,000 points in 60 seconds — free, against a
 * 100-ryo cafeteria Feast and a ~2h46m rest. Dying was the fastest and cheapest
 * full restore in the game, which inverted the incentive the surrounding code
 * was written for ("bailing out of a fight you are losing still means healing
 * before the next one", api/missions/_ai-fight-outcome.ts).
 *
 * The hospital now treats injuries; exhaustion is recovered by resting or at
 * the Cafeteria. Nothing is taken from the player on defeat — this only stops
 * defeat being a REWARD. Pairs with pooledVitalRegenEnabled below, which is
 * what makes resting a real option at high level.
 */
export function hospitalDischargeRestoresHpOnly(env: NodeJS.ProcessEnv = process.env): boolean {
    return env.DISABLE_HP_ONLY_DISCHARGE !== '1';
}

/**
 * Idle vitals regenerate a share of each POOL per second instead of a flat 1
 * point shared by all three (MMORPG behavior audit F1, 2026-09-08). Default ON.
 *
 * A flat 1/sec was tuned for the ~100-point pools of early levels and was never
 * revisited when the v2 curve took them to 10,000 — the same oversight the
 * owner already corrected for cafeteria meals on 2026-07-31 ("the old flats
 * were tuned for ~100-HP pools", api/player/_cafeteria.ts). It made resting
 * dead content above roughly level 20.
 *
 * Each vital now refills in REGEN_FULL_BAR_SEC (30 min) at any level, floored
 * at the old 1/sec so NOBODY regenerates slower than before. Kept separately
 * switchable from the discharge change because it has two mirrors that must
 * move with it — the autosave gain ceiling in api/save/[name].ts and the
 * client's own idle clock — and a mismatch there shows up as vitals appearing
 * to fall on save.
 */
export function pooledVitalRegenEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
    return env.DISABLE_POOLED_VITAL_REGEN !== '1';
}

/**
 * Open-world combat is CONTINUOUS: the fighter brings the HP, chakra and stamina
 * they actually have, and is put back in their spot with whatever is left (owner
 * ruling, 2026-09-08). Default ON.
 *
 * Applies to explore ambushes, world AI fights, field missions, village defense
 * and raid AI. Instanced and consensual content — dives, Spire waves, story
 * bosses, the Academy spar, the weekly boss, Tower runs — keeps its fresh pool,
 * as does a practice spar. Sector PvP was already continuous
 * (`useCurrentVitals`, api/pvp/session.ts) and is unchanged.
 *
 * Gates the SEED only, which is the correct rollback shape: throwing this makes
 * NEW open-world fights fresh-start, while a session already seeded from real
 * vitals still settles the way it was seeded. Flipping the settle instead would
 * strand in-flight fights on a rule they did not start under.
 */
export function openWorldContinuousVitalsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
    return env.DISABLE_OPEN_WORLD_CONTINUOUS_VITALS !== '1';
}
