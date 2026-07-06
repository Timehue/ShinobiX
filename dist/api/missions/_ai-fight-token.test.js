"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const node_assert_1 = require("node:assert");
const _ai_fight_reward_js_1 = require("./_ai-fight-reward.js");
const _ai_fight_token_js_1 = require("./_ai-fight-token.js");
(0, node_test_1.describe)('_ai-fight-token', () => {
    (0, node_test_1.it)('creates a bounded token record', () => {
        const token = (0, _ai_fight_token_js_1.createAiFightTokenRecord)('Player', 'abc123', 12345, {
            opponentId: 'forest-ai:1',
            opponentLevel: 42.9,
        });
        node_assert_1.strict.equal(token.playerName, 'Player');
        node_assert_1.strict.equal(token.tokenId, 'abc123');
        node_assert_1.strict.equal(token.mintedAt, 12345);
        node_assert_1.strict.equal(token.maxXp, _ai_fight_reward_js_1.MAX_AI_FIGHT_XP);
        node_assert_1.strict.equal(token.maxRyo, _ai_fight_reward_js_1.MAX_AI_FIGHT_RYO);
        node_assert_1.strict.equal(token.opponentId, 'forest-ai:1');
        node_assert_1.strict.equal(token.opponentLevel, 42);
    });
    (0, node_test_1.it)('cleans token ids for key use', () => {
        node_assert_1.strict.equal((0, _ai_fight_token_js_1.cleanAiFightToken)(' abcDEF123 '), 'abcDEF123');
        node_assert_1.strict.equal((0, _ai_fight_token_js_1.cleanAiFightToken)('bad-token'), '');
        node_assert_1.strict.equal((0, _ai_fight_token_js_1.aiFightTokenKey)('Player', 'abc123'), 'ai-fight-token:Player:abc123');
    });
    (0, node_test_1.it)('accepts claims at or below the sealed ceiling', () => {
        const token = (0, _ai_fight_token_js_1.createAiFightTokenRecord)('Player', 'abc123');
        node_assert_1.strict.deepEqual((0, _ai_fight_token_js_1.validateAiFightRewardClaim)(token, 125.9, 90.1), { ok: true, xp: 125, ryo: 90 });
        node_assert_1.strict.deepEqual((0, _ai_fight_token_js_1.validateAiFightRewardClaim)(token, -10, 'x'), { ok: true, xp: 0, ryo: 0 });
    });
    (0, node_test_1.it)('rejects claims that exceed the sealed ceiling', () => {
        const token = (0, _ai_fight_token_js_1.createAiFightTokenRecord)('Player', 'abc123');
        node_assert_1.strict.deepEqual((0, _ai_fight_token_js_1.validateAiFightRewardClaim)(token, _ai_fight_reward_js_1.MAX_AI_FIGHT_XP + 1, 90), {
            ok: false,
            reason: 'reward-exceeds-ai-fight-token',
        });
        node_assert_1.strict.deepEqual((0, _ai_fight_token_js_1.validateAiFightRewardClaim)(token, 100, _ai_fight_reward_js_1.MAX_AI_FIGHT_RYO + 1), {
            ok: false,
            reason: 'reward-exceeds-ai-fight-token',
        });
    });
});
