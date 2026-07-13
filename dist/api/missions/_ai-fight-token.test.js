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
            baseXp: 125,
            baseRyo: 90,
            battleKind: 'defense',
        });
        node_assert_1.strict.equal(token.playerName, 'Player');
        node_assert_1.strict.equal(token.tokenId, 'abc123');
        node_assert_1.strict.equal(token.mintedAt, 12345);
        node_assert_1.strict.equal(token.maxXp, _ai_fight_reward_js_1.MAX_AI_FIGHT_XP);
        node_assert_1.strict.equal(token.maxRyo, _ai_fight_reward_js_1.MAX_AI_FIGHT_RYO);
        node_assert_1.strict.equal(token.baseXp, 125);
        node_assert_1.strict.equal(token.baseRyo, 90);
        node_assert_1.strict.equal(token.rewardSource, 'server-save');
        node_assert_1.strict.equal(token.opponentId, 'forest-ai:1');
        node_assert_1.strict.equal(token.opponentLevel, 42);
        node_assert_1.strict.equal(token.battleKind, 'defense');
    });
    (0, node_test_1.it)('normalizes unknown battle kinds to non-paying practice', () => {
        node_assert_1.strict.equal((0, _ai_fight_token_js_1.createAiFightTokenRecord)('Player', 'abc123', 123, { battleKind: 'forged' }).battleKind, 'practice');
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
    (0, node_test_1.it)('uses server-sealed rewards when present instead of client-submitted amounts', () => {
        const token = (0, _ai_fight_token_js_1.createAiFightTokenRecord)('Player', 'abc123', 123, { baseXp: 100, baseRyo: 75 });
        node_assert_1.strict.deepEqual((0, _ai_fight_token_js_1.validateAiFightRewardClaim)(token, 999, 999), { ok: true, xp: 100, ryo: 75 });
    });
    (0, node_test_1.it)('computes AI fight base rewards from the active pet trait', () => {
        node_assert_1.strict.deepEqual((0, _ai_fight_token_js_1.computeAiFightBaseReward)({ activePetId: 'p1', pets: [{ id: 'p1', trait: 'Swift' }] }), { xp: 125, ryo: 75, trait: 'Swift' });
        node_assert_1.strict.deepEqual((0, _ai_fight_token_js_1.computeAiFightBaseReward)({ activePetId: 'p1', pets: [{ id: 'p1', trait: 'Lucky' }] }), { xp: 100, ryo: 90, trait: 'Lucky' });
        node_assert_1.strict.deepEqual((0, _ai_fight_token_js_1.computeAiFightBaseReward)({ activePetId: 'p2', pets: [{ id: 'p1', trait: 'Swift' }] }), { xp: 100, ryo: 75, trait: null });
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
