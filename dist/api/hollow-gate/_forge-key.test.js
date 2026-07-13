"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const node_assert_1 = require("node:assert");
const _forge_key_js_1 = require("./_forge-key.js");
(0, node_test_1.describe)('Hollow Gate key forge', () => {
    (0, node_test_1.it)('requires the attunement and atomically spends Hollow Shards', () => {
        node_assert_1.strict.equal((0, _forge_key_js_1.forgeHollowGateKey)({ hollowShards: 100 }, 'hollowShards').ok, false);
        const result = (0, _forge_key_js_1.forgeHollowGateKey)({ hollowShards: 100, hollowGateAttunement: { 'key-forge': 1 }, inventory: [] }, 'hollowShards');
        node_assert_1.strict.equal(result.ok, true);
        if (result.ok) {
            node_assert_1.strict.equal(result.character.hollowShards, 20);
            node_assert_1.strict.deepEqual(result.character.inventory, ['hollow-gate-key']);
        }
    });
    (0, node_test_1.it)('supports the two Crafter recipes without trusting client deltas', () => {
        const shards = (0, _forge_key_js_1.forgeHollowGateKey)({ fateShards: 12, inventory: [] }, 'fateShards');
        node_assert_1.strict.equal(shards.ok && shards.character.fateShards, 2);
        const keys = (0, _forge_key_js_1.forgeHollowGateKey)({ inventory: ['dungeon-key', 'dungeon-key'], itemStacks: [{ itemId: 'dungeon-key', count: 3 }] }, 'dungeonKeys');
        node_assert_1.strict.equal(keys.ok, true);
        if (keys.ok) {
            node_assert_1.strict.deepEqual(keys.character.itemStacks, []);
            node_assert_1.strict.deepEqual(keys.character.inventory, ['hollow-gate-key']);
        }
    });
    (0, node_test_1.it)('fails closed when materials are insufficient', () => {
        node_assert_1.strict.deepEqual((0, _forge_key_js_1.forgeHollowGateKey)({ fateShards: 9 }, 'fateShards'), { ok: false, reason: 'insufficient-materials' });
    });
});
