"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const node_assert_1 = require("node:assert");
const _war_crate_open_js_1 = require("./_war-crate-open.js");
(0, node_test_1.describe)('_war-crate-open', () => {
    (0, node_test_1.it)('consumes exactly one crate and grants the sealed reward', () => {
        const result = (0, _war_crate_open_js_1.applyWarCrateOpen)({
            inventory: ['starter', _war_crate_open_js_1.LEGENDARY_WAR_CRATE_ID, _war_crate_open_js_1.LEGENDARY_WAR_CRATE_ID],
            profession: 'vanguard',
            ryo: 25,
            honorSeals: 2,
            boneCharms: 3,
        }, true);
        node_assert_1.strict.ok(result);
        node_assert_1.strict.deepEqual(result.reward, { ryo: 500, honorSeals: 10, boneCharms: 1, gotDungeonKey: true });
        node_assert_1.strict.deepEqual(result.character.inventory, ['starter', _war_crate_open_js_1.LEGENDARY_WAR_CRATE_ID, _war_crate_open_js_1.WARFORGED_RELIC_ID, _war_crate_open_js_1.DUNGEON_KEY_ID]);
        node_assert_1.strict.equal(result.character.ryo, 525);
        node_assert_1.strict.equal(result.character.honorSeals, 12);
        node_assert_1.strict.equal(result.character.boneCharms, 4);
    });
    (0, node_test_1.it)('grants no Honor Seals to non-Vanguards and does not mutate input', () => {
        const input = { inventory: [_war_crate_open_js_1.LEGENDARY_WAR_CRATE_ID], profession: 'healer', ryo: 0 };
        const result = (0, _war_crate_open_js_1.applyWarCrateOpen)(input, false);
        node_assert_1.strict.ok(result);
        node_assert_1.strict.equal(result.reward.honorSeals, 0);
        node_assert_1.strict.deepEqual(input.inventory, [_war_crate_open_js_1.LEGENDARY_WAR_CRATE_ID]);
        node_assert_1.strict.deepEqual(result.character.inventory, [_war_crate_open_js_1.WARFORGED_RELIC_ID]);
    });
    (0, node_test_1.it)('refuses to mint rewards without a stored crate', () => {
        node_assert_1.strict.equal((0, _war_crate_open_js_1.applyWarCrateOpen)({ inventory: [], ryo: 100 }, true), null);
    });
});
