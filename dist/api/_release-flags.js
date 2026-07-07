"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.COMBAT_MISSION_CLIENT_TRUST_DISABLED_REASON = exports.WEEKLY_BOSS_CLIENT_DAMAGE_DISABLED_REASON = void 0;
exports.weeklyBossClientDamageEnabled = weeklyBossClientDamageEnabled;
exports.clientTrustedCombatMissionRewardAllowed = clientTrustedCombatMissionRewardAllowed;
exports.WEEKLY_BOSS_CLIENT_DAMAGE_DISABLED_REASON = 'weekly_boss_server_authority_required';
exports.COMBAT_MISSION_CLIENT_TRUST_DISABLED_REASON = 'server_authoritative_combat_required';
function weeklyBossClientDamageEnabled(env = process.env) {
    return env.ENABLE_WEEKLY_BOSS_CLIENT_DAMAGE === '1';
}
function clientTrustedCombatMissionRewardAllowed(def, env = process.env) {
    if (env.ENABLE_CLIENT_TRUSTED_COMBAT_MISSION_REWARDS === '1')
        return true;
    return def.min <= 5 && def.xp <= 25 && def.ryo <= 20 && def.territoryScrolls <= 1;
}
