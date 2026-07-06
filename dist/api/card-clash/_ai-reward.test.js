"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const node_assert_1 = require("node:assert");
const _ai_reward_js_1 = require("./_ai-reward.js");
(0, node_test_1.describe)('_ai-reward', () => {
    (0, node_test_1.it)('cleans only supported AI match results', () => {
        node_assert_1.strict.equal((0, _ai_reward_js_1.cleanCardClashAiResult)('player'), 'player');
        node_assert_1.strict.equal((0, _ai_reward_js_1.cleanCardClashAiResult)('opponent'), 'opponent');
        node_assert_1.strict.equal((0, _ai_reward_js_1.cleanCardClashAiResult)('draw'), 'draw');
        node_assert_1.strict.equal((0, _ai_reward_js_1.cleanCardClashAiResult)('win'), null);
    });
    (0, node_test_1.it)('pays the first win bonus once', () => {
        node_assert_1.strict.deepEqual((0, _ai_reward_js_1.cardClashAiReward)('player', false), { ryo: 50 + _ai_reward_js_1.CARD_CLASH_AI_DAILY_WIN_BONUS_RYO, dailyBonus: true });
        node_assert_1.strict.deepEqual((0, _ai_reward_js_1.cardClashAiReward)('player', true), { ryo: 50, dailyBonus: false });
        node_assert_1.strict.deepEqual((0, _ai_reward_js_1.cardClashAiReward)('draw', false), { ryo: 15, dailyBonus: false });
        node_assert_1.strict.deepEqual((0, _ai_reward_js_1.cardClashAiReward)('opponent', false), { ryo: 5, dailyBonus: false });
    });
});
