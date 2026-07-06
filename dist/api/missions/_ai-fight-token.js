"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AI_FIGHT_TOKEN_TTL_SECONDS = void 0;
exports.cleanAiFightToken = cleanAiFightToken;
exports.aiFightTokenKey = aiFightTokenKey;
exports.createAiFightTokenRecord = createAiFightTokenRecord;
exports.validateAiFightRewardClaim = validateAiFightRewardClaim;
const _ai_fight_reward_js_1 = require("./_ai-fight-reward.js");
exports.AI_FIGHT_TOKEN_TTL_SECONDS = 20 * 60;
function cleanAiFightToken(raw) {
    const token = typeof raw === 'string' ? raw.trim().slice(0, 96) : '';
    return /^[A-Za-z0-9]+$/.test(token) ? token : '';
}
function aiFightTokenKey(playerName, token) {
    return `ai-fight-token:${playerName}:${token}`;
}
function createAiFightTokenRecord(playerName, tokenId, now = Date.now(), context = {}) {
    const opponentIdRaw = typeof context.opponentId === 'string' ? context.opponentId.trim().slice(0, 96) : '';
    const opponentId = /^[A-Za-z0-9:_-]+$/.test(opponentIdRaw) ? opponentIdRaw : undefined;
    const opponentLevelNum = Math.floor(Number(context.opponentLevel ?? 0));
    const opponentLevel = Number.isFinite(opponentLevelNum) && opponentLevelNum > 0
        ? Math.min(250, opponentLevelNum)
        : undefined;
    return {
        playerName,
        tokenId,
        mintedAt: now,
        maxXp: _ai_fight_reward_js_1.MAX_AI_FIGHT_XP,
        maxRyo: _ai_fight_reward_js_1.MAX_AI_FIGHT_RYO,
        ...(opponentId ? { opponentId } : {}),
        ...(opponentLevel ? { opponentLevel } : {}),
    };
}
function validateAiFightRewardClaim(token, claimedXp, claimedRyo) {
    if (!token || !Number.isFinite(Number(token.maxXp)) || !Number.isFinite(Number(token.maxRyo))) {
        return { ok: false, reason: 'invalid-ai-fight-token' };
    }
    const xp = Math.max(0, Math.floor(Number(claimedXp) || 0));
    const ryo = Math.max(0, Math.floor(Number(claimedRyo) || 0));
    const maxXp = Math.max(0, Math.floor(Number(token.maxXp) || 0));
    const maxRyo = Math.max(0, Math.floor(Number(token.maxRyo) || 0));
    if (xp > maxXp || ryo > maxRyo) {
        return { ok: false, reason: 'reward-exceeds-ai-fight-token' };
    }
    return { ok: true, xp, ryo };
}
