"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const node_assert_1 = require("node:assert");
const _reward_farm_js_1 = require("./_reward-farm.js");
(0, node_test_1.describe)('repeatWinDecayMultiplier', () => {
    (0, node_test_1.it)('pays the first two wins in full', () => {
        node_assert_1.strict.equal((0, _reward_farm_js_1.repeatWinDecayMultiplier)(0), 1);
        node_assert_1.strict.equal((0, _reward_farm_js_1.repeatWinDecayMultiplier)(1), 1);
    });
    (0, node_test_1.it)('tapers after the second win', () => {
        node_assert_1.strict.equal((0, _reward_farm_js_1.repeatWinDecayMultiplier)(2), 0.5);
        node_assert_1.strict.equal((0, _reward_farm_js_1.repeatWinDecayMultiplier)(3), 0.25);
    });
    (0, node_test_1.it)('floors at 0.1 for sustained farming', () => {
        node_assert_1.strict.equal((0, _reward_farm_js_1.repeatWinDecayMultiplier)(4), 0.1);
        node_assert_1.strict.equal((0, _reward_farm_js_1.repeatWinDecayMultiplier)(10), 0.1);
        node_assert_1.strict.equal((0, _reward_farm_js_1.repeatWinDecayMultiplier)(1000), 0.1);
    });
    (0, node_test_1.it)('never returns a value above 1 or below the floor', () => {
        for (let n = 0; n <= 50; n++) {
            const m = (0, _reward_farm_js_1.repeatWinDecayMultiplier)(n);
            node_assert_1.strict.ok(m <= 1, `multiplier ${m} for ${n} exceeds 1`);
            node_assert_1.strict.ok(m >= 0.1, `multiplier ${m} for ${n} below floor`);
        }
    });
    (0, node_test_1.it)('clamps/floors non-integer and negative inputs defensively', () => {
        node_assert_1.strict.equal((0, _reward_farm_js_1.repeatWinDecayMultiplier)(-5), 1);
        node_assert_1.strict.equal((0, _reward_farm_js_1.repeatWinDecayMultiplier)(2.9), 0.5); // floor(2.9)=2
    });
    (0, node_test_1.it)('uses a one-hour farm window', () => {
        node_assert_1.strict.equal(_reward_farm_js_1.REPEAT_WIN_WINDOW_SECONDS, 3600);
    });
});
