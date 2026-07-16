"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PLAYER_AI_IMAGE_GENERATION_DISABLED_REASON = exports.COMBAT_MISSION_CLIENT_TRUST_DISABLED_REASON = exports.WEEKLY_BOSS_CLIENT_DAMAGE_DISABLED_REASON = void 0;
exports.weeklyBossClientDamageEnabled = weeklyBossClientDamageEnabled;
exports.playerAiImageGenerationEnabled = playerAiImageGenerationEnabled;
exports.clientTrustedCombatMissionRewardAllowed = clientTrustedCombatMissionRewardAllowed;
exports.combatMissionClaimAuthorityAllowed = combatMissionClaimAuthorityAllowed;
exports.WEEKLY_BOSS_CLIENT_DAMAGE_DISABLED_REASON = 'weekly_boss_server_authority_required';
exports.COMBAT_MISSION_CLIENT_TRUST_DISABLED_REASON = 'server_authoritative_combat_required';
exports.PLAYER_AI_IMAGE_GENERATION_DISABLED_REASON = 'player_ai_image_generation_public_beta_disabled';
function weeklyBossClientDamageEnabled(env = process.env) {
    return env.ENABLE_WEEKLY_BOSS_CLIENT_DAMAGE === '1';
}
function playerAiImageGenerationEnabled(env = process.env) {
    return env.ENABLE_PLAYER_AI_IMAGE_GENERATION === '1';
}
function clientTrustedCombatMissionRewardAllowed(def, env = process.env) {
    if (env.ENABLE_CLIENT_TRUSTED_COMBAT_MISSION_REWARDS === '1')
        return true;
    return def.min <= 5 && def.xp <= 25 && def.ryo <= 20 && def.territoryScrolls <= 1;
}
/** High-rank combat claims require the token minted from a completed server session. */
function combatMissionClaimAuthorityAllowed(def, tokenRecord, env = process.env) {
    if (clientTrustedCombatMissionRewardAllowed(def, env))
        return true;
    return !!tokenRecord
        && typeof tokenRecord === 'object'
        && tokenRecord.authority === 'server-combat';
}
