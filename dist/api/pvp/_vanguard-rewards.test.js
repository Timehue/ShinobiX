"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const node_assert_1 = require("node:assert");
const _vanguard_rewards_js_1 = require("./_vanguard-rewards.js");
(0, node_test_1.describe)('levelGapMult', () => {
    (0, node_test_1.it)('full reward within 10 levels (either direction)', () => {
        node_assert_1.strict.equal((0, _vanguard_rewards_js_1.levelGapMult)(40, 30), 1);
        node_assert_1.strict.equal((0, _vanguard_rewards_js_1.levelGapMult)(40, 40), 1);
        node_assert_1.strict.equal((0, _vanguard_rewards_js_1.levelGapMult)(40, 50), 1);
    });
    (0, node_test_1.it)('50% reward 10-20 levels below attacker', () => {
        node_assert_1.strict.equal((0, _vanguard_rewards_js_1.levelGapMult)(50, 39), 0.5);
        node_assert_1.strict.equal((0, _vanguard_rewards_js_1.levelGapMult)(50, 30), 0.5);
    });
    (0, node_test_1.it)('0 reward >20 levels below attacker', () => {
        node_assert_1.strict.equal((0, _vanguard_rewards_js_1.levelGapMult)(50, 29), 0);
        node_assert_1.strict.equal((0, _vanguard_rewards_js_1.levelGapMult)(100, 1), 0);
    });
    (0, node_test_1.it)('no penalty for fighting higher-level players', () => {
        node_assert_1.strict.equal((0, _vanguard_rewards_js_1.levelGapMult)(30, 100), 1);
    });
});
(0, node_test_1.describe)('vanguardXpForLevel', () => {
    (0, node_test_1.it)('returns 100 XP for level 1-30 opponents', () => {
        node_assert_1.strict.equal((0, _vanguard_rewards_js_1.vanguardXpForLevel)(1), 100);
        node_assert_1.strict.equal((0, _vanguard_rewards_js_1.vanguardXpForLevel)(30), 100);
    });
    (0, node_test_1.it)('adds +10 XP per level above 30', () => {
        node_assert_1.strict.equal((0, _vanguard_rewards_js_1.vanguardXpForLevel)(31), 110);
        node_assert_1.strict.equal((0, _vanguard_rewards_js_1.vanguardXpForLevel)(50), 300);
        node_assert_1.strict.equal((0, _vanguard_rewards_js_1.vanguardXpForLevel)(100), 800);
    });
});
(0, node_test_1.describe)('vanguardSealsForRank', () => {
    (0, node_test_1.it)('matches the rank table (1,1,2,2,3,3,4,4,5,5)', () => {
        node_assert_1.strict.equal((0, _vanguard_rewards_js_1.vanguardSealsForRank)(1), 1);
        node_assert_1.strict.equal((0, _vanguard_rewards_js_1.vanguardSealsForRank)(2), 1);
        node_assert_1.strict.equal((0, _vanguard_rewards_js_1.vanguardSealsForRank)(3), 2);
        node_assert_1.strict.equal((0, _vanguard_rewards_js_1.vanguardSealsForRank)(4), 2);
        node_assert_1.strict.equal((0, _vanguard_rewards_js_1.vanguardSealsForRank)(5), 3);
        node_assert_1.strict.equal((0, _vanguard_rewards_js_1.vanguardSealsForRank)(6), 3);
        node_assert_1.strict.equal((0, _vanguard_rewards_js_1.vanguardSealsForRank)(7), 4);
        node_assert_1.strict.equal((0, _vanguard_rewards_js_1.vanguardSealsForRank)(8), 4);
        node_assert_1.strict.equal((0, _vanguard_rewards_js_1.vanguardSealsForRank)(9), 5);
        node_assert_1.strict.equal((0, _vanguard_rewards_js_1.vanguardSealsForRank)(10), 5);
    });
    (0, node_test_1.it)('rank 0 returns 0 (unranked)', () => {
        node_assert_1.strict.equal((0, _vanguard_rewards_js_1.vanguardSealsForRank)(0), 0);
    });
    (0, node_test_1.it)('clamps above rank 10', () => {
        node_assert_1.strict.equal((0, _vanguard_rewards_js_1.vanguardSealsForRank)(99), 5);
    });
});
(0, node_test_1.describe)('rankFromXp (baseline curve)', () => {
    (0, node_test_1.it)('Rank 1 at 0 XP', () => {
        node_assert_1.strict.equal((0, _vanguard_rewards_js_1.rankFromXp)(0), 1);
    });
    (0, node_test_1.it)('Rank 2 at 100 XP (first threshold)', () => {
        node_assert_1.strict.equal((0, _vanguard_rewards_js_1.rankFromXp)(100), 2);
        node_assert_1.strict.equal((0, _vanguard_rewards_js_1.rankFromXp)(99), 1);
    });
    (0, node_test_1.it)('Rank 10 at 32,850 XP (max threshold)', () => {
        node_assert_1.strict.equal((0, _vanguard_rewards_js_1.rankFromXp)(32850), 10);
        node_assert_1.strict.equal((0, _vanguard_rewards_js_1.rankFromXp)(32849), 9);
    });
    (0, node_test_1.it)('caps at Rank 10 above max threshold', () => {
        node_assert_1.strict.equal((0, _vanguard_rewards_js_1.rankFromXp)(1_000_000), 10);
    });
});
