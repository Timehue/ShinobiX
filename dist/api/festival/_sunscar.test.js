"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const node_assert_1 = require("node:assert");
const _sunscar_js_1 = require("./_sunscar.js");
(0, node_test_1.describe)('_sunscar', () => {
    (0, node_test_1.it)('keeps the dice cost and daily cap pinned', () => {
        node_assert_1.strict.equal(_sunscar_js_1.FATE_DICE_COST, 25);
        node_assert_1.strict.equal(_sunscar_js_1.FATE_DICE_DAILY_CAP, 5);
    });
    (0, node_test_1.it)('rolls the legendary eye triple payout server-side', () => {
        const values = [0.34, 0.34, 0.34];
        const result = (0, _sunscar_js_1.rollFateDice)(() => values.shift() ?? 0);
        node_assert_1.strict.deepEqual(result.roll, ['eye', 'eye', 'eye']);
        node_assert_1.strict.deepEqual(result.reward, {
            ryo: 0,
            xp: 0,
            stamina: 0,
            boneCharms: 10,
            fateShards: 5,
            auraStones: 5,
        });
    });
    (0, node_test_1.it)('sanitizes Miraa wagers and returns fixed deltas', () => {
        node_assert_1.strict.equal((0, _sunscar_js_1.cleanMiraaBet)(100), 100);
        node_assert_1.strict.equal((0, _sunscar_js_1.cleanMiraaBet)(75), 0);
        node_assert_1.strict.equal((0, _sunscar_js_1.cleanMiraaOutcome)('win'), 'win');
        node_assert_1.strict.equal((0, _sunscar_js_1.cleanMiraaOutcome)('cheat'), null);
        node_assert_1.strict.equal((0, _sunscar_js_1.miraaRyoDelta)(250, 'win'), 500);
        node_assert_1.strict.equal((0, _sunscar_js_1.miraaRyoDelta)(250, 'loss'), -250);
        node_assert_1.strict.equal((0, _sunscar_js_1.miraaRyoDelta)(250, 'forfeit'), -250);
        node_assert_1.strict.equal((0, _sunscar_js_1.miraaRyoDelta)(250, 'draw'), 0);
    });
});
