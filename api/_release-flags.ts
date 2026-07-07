import type { CombatMissionDef } from './missions/_mission-catalog.js';

export const WEEKLY_BOSS_CLIENT_DAMAGE_DISABLED_REASON = 'weekly_boss_server_authority_required';
export const COMBAT_MISSION_CLIENT_TRUST_DISABLED_REASON = 'server_authoritative_combat_required';

export function weeklyBossClientDamageEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
    return env.ENABLE_WEEKLY_BOSS_CLIENT_DAMAGE === '1';
}

export function clientTrustedCombatMissionRewardAllowed(
    def: CombatMissionDef,
    env: NodeJS.ProcessEnv = process.env,
): boolean {
    if (env.ENABLE_CLIENT_TRUSTED_COMBAT_MISSION_REWARDS === '1') return true;
    return def.min <= 5 && def.xp <= 25 && def.ryo <= 20 && def.territoryScrolls <= 1;
}
