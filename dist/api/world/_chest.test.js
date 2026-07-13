"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const node_assert_1 = require("node:assert");
const _chest_js_1 = require("./_chest.js");
function sequence(...values) { let i = 0; return () => values[i++] ?? 0; }
(0, node_test_1.describe)('ancient chest settlement', () => {
    (0, node_test_1.it)('rolls rewards from canonical server pools', () => {
        node_assert_1.strict.deepEqual((0, _chest_js_1.rollAncientChestLoot)(10, sequence(0.1, 0.5, 0.3, 0.9)), { xp: 70, ryo: 300, itemId: 'shinobi-vest' });
        const card = (0, _chest_js_1.rollAncientChestLoot)(60, sequence(0.9, 0.84, 0.5, 0.9));
        node_assert_1.strict.equal(card?.cardId, 'tc-71');
        node_assert_1.strict.equal(card?.xp, 170);
    });
    (0, node_test_1.it)('commits balances and ownership without duplicating unique drops', () => {
        const next = (0, _chest_js_1.applyAncientChestLoot)({ level: 1, xp: 0, ryo: 10, inventory: ['shinobi-vest'], tileCards: [] }, { xp: 50, ryo: 100, itemId: 'shinobi-vest', fateShards: 1 });
        node_assert_1.strict.equal(next.ryo, 110);
        node_assert_1.strict.equal(next.fateShards, 1);
        node_assert_1.strict.deepEqual(next.inventory, ['shinobi-vest']);
    });
    (0, node_test_1.it)('allows repeated stackable treat drops', () => {
        const next = (0, _chest_js_1.applyAncientChestLoot)({ level: 1, xp: 0, inventory: ['pet-treat'], tileCards: [] }, { xp: 50, itemId: 'pet-treat' });
        node_assert_1.strict.deepEqual(next.inventory, ['pet-treat', 'pet-treat']);
    });
});
