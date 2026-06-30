"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const node_assert_1 = require("node:assert");
const _ai_fight_reward_js_1 = require("./_ai-fight-reward.js");
(0, node_test_1.describe)('_ai-fight-reward — daily soft-cap (P0.2b)', () => {
    (0, node_test_1.it)('first win of the day pays full reward', () => {
        const r = (0, _ai_fight_reward_js_1.aiFightReward)(125, 90, 1);
        node_assert_1.strict.deepEqual(r, { xp: 125, ryo: 90, capped: false });
    });
    (0, node_test_1.it)('pays full reward up to (and including) the soft cap', () => {
        const r = (0, _ai_fight_reward_js_1.aiFightReward)(100, 75, _ai_fight_reward_js_1.AI_FIGHT_SOFT_CAP_PER_DAY);
        node_assert_1.strict.deepEqual(r, { xp: 100, ryo: 75, capped: false });
    });
    (0, node_test_1.it)('reduces the reward past the soft cap', () => {
        const r = (0, _ai_fight_reward_js_1.aiFightReward)(100, 80, _ai_fight_reward_js_1.AI_FIGHT_SOFT_CAP_PER_DAY + 1);
        node_assert_1.strict.equal(r.xp, Math.floor(100 * _ai_fight_reward_js_1.AI_FIGHT_REDUCED_MULT));
        node_assert_1.strict.equal(r.ryo, Math.floor(80 * _ai_fight_reward_js_1.AI_FIGHT_REDUCED_MULT));
        node_assert_1.strict.equal(r.capped, true);
    });
    (0, node_test_1.it)('clamps the per-fight base (anti-inflation)', () => {
        const r = (0, _ai_fight_reward_js_1.aiFightReward)(99999, 99999, 1);
        node_assert_1.strict.equal(r.xp, _ai_fight_reward_js_1.MAX_AI_FIGHT_XP);
        node_assert_1.strict.equal(r.ryo, _ai_fight_reward_js_1.MAX_AI_FIGHT_RYO);
    });
    (0, node_test_1.it)('handles non-numeric / negative input safely', () => {
        node_assert_1.strict.deepEqual((0, _ai_fight_reward_js_1.aiFightReward)('x', -50, 1), { xp: 0, ryo: 0, capped: false });
    });
});
