"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const node_assert_1 = require("node:assert");
const _cafeteria_js_1 = require("./_cafeteria.js");
(0, node_test_1.describe)('_cafeteria', () => {
    (0, node_test_1.it)('applies the small ramen cost and stat restoration', () => {
        const meal = (0, _cafeteria_js_1.cafeteriaMeal)('small-ramen');
        node_assert_1.strict.ok(meal);
        const result = (0, _cafeteria_js_1.applyCafeteriaMeal)({
            ryo: 25,
            hp: 10,
            maxHp: 30,
            chakra: 1,
            maxChakra: 9,
            stamina: 2,
            maxStamina: 50,
        }, meal);
        node_assert_1.strict.equal(result.ok, true);
        if (!result.ok)
            return;
        node_assert_1.strict.equal(result.character.ryo, 5);
        node_assert_1.strict.equal(result.character.hp, 30);
        node_assert_1.strict.equal(result.character.chakra, 9);
        node_assert_1.strict.equal(result.character.stamina, 12);
    });
    (0, node_test_1.it)('rejects unaffordable meals without changing the character', () => {
        const meal = (0, _cafeteria_js_1.cafeteriaMeal)('feast');
        node_assert_1.strict.ok(meal);
        const result = (0, _cafeteria_js_1.applyCafeteriaMeal)({ ryo: 99, hp: 1, maxHp: 100 }, meal);
        node_assert_1.strict.equal(result.ok, false);
    });
});
