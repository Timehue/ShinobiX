"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const node_assert_1 = require("node:assert");
const _encounter_js_1 = require("./_encounter.js");
(0, node_test_1.describe)('wild pet encounter authority', () => {
    (0, node_test_1.it)('uses the canonical rarity thresholds and catalog', () => {
        node_assert_1.strict.equal((0, _encounter_js_1.rollWildPet)(() => 0.5), null);
        const values = [0.001, 0];
        let i = 0;
        const pet = (0, _encounter_js_1.rollWildPet)(() => values[i++] ?? 0, 123);
        node_assert_1.strict.equal(pet?.rarity, 'mythic');
        node_assert_1.strict.match(String(pet?.id), /^mythic-\d+-123$/);
    });
    (0, node_test_1.it)('grants a server-rolled trait and enforces the five-pet cap', () => {
        const result = (0, _encounter_js_1.grantWildPet)({ pets: [] }, { id: 'rare-1-123', rarity: 'rare', attack: 100, hp: 100, defense: 100, speed: 100 }, () => 0.2);
        node_assert_1.strict.equal(result.ok, true);
        if (result.ok)
            node_assert_1.strict.equal(result.character.pets[0].trait, 'Aggressive');
        node_assert_1.strict.equal((0, _encounter_js_1.grantWildPet)({ pets: [{}, {}, {}, {}, {}] }, { id: 'x' }, () => 0).ok, false);
    });
});
