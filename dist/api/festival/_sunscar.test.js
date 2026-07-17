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
    (0, node_test_1.it)('sanitizes Miraa wagers to the allowed bet ladder', () => {
        node_assert_1.strict.equal((0, _sunscar_js_1.cleanMiraaBet)(100), 100);
        node_assert_1.strict.equal((0, _sunscar_js_1.cleanMiraaBet)(75), 0);
        node_assert_1.strict.equal((0, _sunscar_js_1.cleanMiraaBet)('500'), 500);
        node_assert_1.strict.equal((0, _sunscar_js_1.cleanMiraaBet)(-50), 0);
    });
    (0, node_test_1.it)('pins the owner-approved Miraa win chance', () => {
        node_assert_1.strict.equal(_sunscar_js_1.MIRAA_WIN_CHANCE, 0.4);
    });
    (0, node_test_1.it)('server-rolls Miraa from the sealed bet — never a client outcome', () => {
        // rand() < 0.4 → WIN: pays 2×stake back (net +bet vs. the escrow taken at
        // start), right up to the boundary.
        node_assert_1.strict.deepEqual((0, _sunscar_js_1.resolveMiraaWager)(250, false, () => 0.1), { outcome: 'win', credit: 500 });
        node_assert_1.strict.deepEqual((0, _sunscar_js_1.resolveMiraaWager)(250, false, () => 0.39999), { outcome: 'win', credit: 500 });
        // rand() >= 0.4 → LOSS: no credit, the escrowed stake is kept (net −bet).
        node_assert_1.strict.deepEqual((0, _sunscar_js_1.resolveMiraaWager)(250, false, () => 0.4), { outcome: 'loss', credit: 0 });
        node_assert_1.strict.deepEqual((0, _sunscar_js_1.resolveMiraaWager)(250, false, () => 0.9), { outcome: 'loss', credit: 0 });
        // Forfeit (left mid-match) is an automatic loss with no roll.
        node_assert_1.strict.deepEqual((0, _sunscar_js_1.resolveMiraaWager)(250, true, () => 0.0), { outcome: 'forfeit', credit: 0 });
        // Invalid bets never pay.
        node_assert_1.strict.deepEqual((0, _sunscar_js_1.resolveMiraaWager)(75, false, () => 0.0), { outcome: 'loss', credit: 0 });
    });
});
