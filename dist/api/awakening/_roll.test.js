"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const node_assert_1 = require("node:assert");
const _roll_js_1 = require("./_roll.js");
(0, node_test_1.describe)('Elemental awakening authority', () => {
    (0, node_test_1.it)('grants each level reward once with canonical unique elements', () => {
        const first = (0, _roll_js_1.rollAwakening)({ level: 20, fateShards: 0 }, _roll_js_1.AWAKENING_FREE_LV2_ID, 'awakening_action_1', () => 0);
        node_assert_1.strict.equal(first.ok, true);
        if (!first.ok)
            return;
        node_assert_1.strict.deepEqual(first.character.elements, ['Water']);
        const second = (0, _roll_js_1.rollAwakening)(first.character, _roll_js_1.AWAKENING_FREE_LV20_ID, 'awakening_action_2', () => 0);
        node_assert_1.strict.equal(second.ok, true);
        if (!second.ok)
            return;
        node_assert_1.strict.deepEqual(second.character.elements, ['Water', 'Wind']);
    });
    (0, node_test_1.it)('atomically charges paid rerolls and replays safely', () => {
        const first = (0, _roll_js_1.rollAwakening)({ level: 20, fateShards: 20, elements: ['Fire', 'Earth'] }, 'paid', 'awakening_action_3', () => 0);
        node_assert_1.strict.equal(first.ok, true);
        if (!first.ok)
            return;
        node_assert_1.strict.equal(first.character.fateShards, 10);
        node_assert_1.strict.equal(new Set(first.character.elements).size, 2);
        const replay = (0, _roll_js_1.rollAwakening)(first.character, 'paid', 'awakening_action_3', () => 0);
        node_assert_1.strict.equal(replay.ok, true);
        if (replay.ok)
            node_assert_1.strict.equal(replay.alreadyApplied, true);
    });
});
