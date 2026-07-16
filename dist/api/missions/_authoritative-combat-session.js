"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MISSION_COMBAT_SESSION_TTL_SECONDS = exports.MISSION_COMBAT_SESSION_TTL_MS = void 0;
exports.missionCombatBindingKey = missionCombatBindingKey;
exports.missionCombatRewardFingerprint = missionCombatRewardFingerprint;
exports.createMissionCombatBinding = createMissionCombatBinding;
exports.validateCompletedMissionCombatSession = validateCompletedMissionCombatSession;
exports.settleMissionCombatBinding = settleMissionCombatBinding;
const node_crypto_1 = require("node:crypto");
exports.MISSION_COMBAT_SESSION_TTL_MS = 45 * 60 * 1000;
exports.MISSION_COMBAT_SESSION_TTL_SECONDS = Math.ceil(exports.MISSION_COMBAT_SESSION_TTL_MS / 1000);
function missionCombatBindingKey(runId) {
    return `mission-combat-binding:${runId}`;
}
function missionCombatRewardFingerprint(def) {
    return (0, node_crypto_1.createHash)('sha256').update(JSON.stringify({
        missionId: def.key,
        enemyProfileId: def.aiProfileId,
        xp: def.xp,
        ryo: def.ryo,
        territoryScrolls: def.territoryScrolls,
    })).digest('hex');
}
function createMissionCombatBinding(params) {
    const now = params.now ?? Date.now();
    return {
        version: 1,
        sessionId: params.sessionId ?? `mcombat-${(0, node_crypto_1.randomUUID)()}`,
        runId: params.runId,
        playerName: params.playerName,
        missionId: params.mission.key,
        enemyProfileId: params.mission.aiProfileId,
        rewardFingerprint: missionCombatRewardFingerprint(params.mission),
        createdAt: now,
        expiresAt: now + exports.MISSION_COMBAT_SESSION_TTL_MS,
        status: 'active',
    };
}
function validateCompletedMissionCombatSession(params) {
    const { binding, session, playerName, mission } = params;
    const now = params.now ?? Date.now();
    if (!binding || binding.version !== 1 || !binding.sessionId || !binding.runId)
        return { ok: false, reason: 'invalid-binding' };
    if (binding.playerName !== playerName)
        return { ok: false, reason: 'wrong-player' };
    if (binding.missionId !== mission.key || binding.enemyProfileId !== mission.aiProfileId)
        return { ok: false, reason: 'wrong-mission' };
    if (!session || binding.runId !== session.runId)
        return { ok: false, reason: 'wrong-run' };
    if (binding.expiresAt <= now)
        return { ok: false, reason: 'expired' };
    if (binding.settledAt || binding.status !== 'active')
        return { ok: false, reason: 'already-settled' };
    if (session.status !== 'done')
        return { ok: false, reason: 'not-complete' };
    if (session.winner !== 'squad')
        return { ok: false, reason: 'not-won' };
    if (!session.actors.some((actor) => actor.side === 'squad' && actor.ownerSlug === playerName)) {
        return { ok: false, reason: 'not-a-member' };
    }
    if (binding.rewardFingerprint !== missionCombatRewardFingerprint(mission))
        return { ok: false, reason: 'reward-drift' };
    return { ok: true, binding };
}
function settleMissionCombatBinding(binding, now = Date.now()) {
    if (binding.status !== 'active' || binding.settledAt)
        return binding;
    return { ...binding, status: 'won', settledAt: now };
}
