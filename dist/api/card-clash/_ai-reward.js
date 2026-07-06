"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CARD_CLASH_AI_TOKEN_TTL_SECONDS = exports.CARD_CLASH_AI_MIN_WIN_DURATION_MS = exports.CARD_CLASH_AI_DAILY_WIN_BONUS_RYO = exports.CARD_CLASH_AI_BASE_RYO = void 0;
exports.cardClashAiTokenKey = cardClashAiTokenKey;
exports.cleanCardClashAiResult = cleanCardClashAiResult;
exports.utcDateKey = utcDateKey;
exports.cardClashAiReward = cardClashAiReward;
exports.CARD_CLASH_AI_BASE_RYO = {
    player: 50,
    draw: 15,
    opponent: 5,
};
exports.CARD_CLASH_AI_DAILY_WIN_BONUS_RYO = 250;
exports.CARD_CLASH_AI_MIN_WIN_DURATION_MS = 15_000;
exports.CARD_CLASH_AI_TOKEN_TTL_SECONDS = 2 * 60 * 60;
function cardClashAiTokenKey(matchId) {
    return `cc-ai:${matchId}`;
}
function cleanCardClashAiResult(raw) {
    const result = String(raw ?? '');
    return result === 'player' || result === 'opponent' || result === 'draw' ? result : null;
}
function utcDateKey(now = Date.now()) {
    return new Date(now).toISOString().slice(0, 10);
}
function cardClashAiReward(result, alreadyWonToday) {
    const dailyBonus = result === 'player' && !alreadyWonToday;
    return {
        ryo: exports.CARD_CLASH_AI_BASE_RYO[result] + (dailyBonus ? exports.CARD_CLASH_AI_DAILY_WIN_BONUS_RYO : 0),
        dailyBonus,
    };
}
