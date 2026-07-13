"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const node_assert_1 = require("node:assert");
const _entitlement_guard_js_1 = require("./_entitlement-guard.js");
(0, node_test_1.describe)('_entitlement-guard', () => {
    (0, node_test_1.it)('identifies server-owned items and high-rarity built-in cards', () => {
        node_assert_1.strict.equal((0, _entitlement_guard_js_1.isServerOwnedItemId)('weekly-boss-core'), true);
        node_assert_1.strict.equal((0, _entitlement_guard_js_1.isServerOwnedItemId)('shinobi-vest'), false);
        node_assert_1.strict.equal((0, _entitlement_guard_js_1.isHighRiskTileCardId)('tc-41'), true);
        node_assert_1.strict.equal((0, _entitlement_guard_js_1.isHighRiskTileCardId)('tc-121'), true);
        node_assert_1.strict.equal((0, _entitlement_guard_js_1.isHighRiskTileCardId)('tc-21'), false);
    });
    (0, node_test_1.it)('conserves all ordinary item ownership across array-to-stack migration', () => {
        node_assert_1.strict.deepEqual((0, _entitlement_guard_js_1.preserveOwnedItems)(['shinobi-vest', 'forged-item'], [{ itemId: 'pet-treat', count: 3 }, { itemId: 'forged-stack', count: 9 }], ['shinobi-vest', 'pet-treat', 'pet-treat', 'pet-treat'], []), { inventory: ['shinobi-vest'], itemStacks: [{ itemId: 'pet-treat', count: 3 }] });
    });
    (0, node_test_1.it)('preserves existing guarded inventory but drops new additions', () => {
        node_assert_1.strict.deepEqual((0, _entitlement_guard_js_1.preserveEntitledStringArray)(['shinobi-vest', 'weekly-boss-core', 'weekly-boss-core', 'dungeon-key'], ['weekly-boss-core'], _entitlement_guard_js_1.isServerOwnedItemId), ['shinobi-vest', 'weekly-boss-core']);
    });
    (0, node_test_1.it)('caps guarded stack increases to the stored entitlement', () => {
        node_assert_1.strict.deepEqual((0, _entitlement_guard_js_1.preserveEntitledStacks)([{ itemId: 'dungeon-legendary-fragment', count: 9 }, { itemId: 'pet-treat', count: 3 }], [{ itemId: 'dungeon-legendary-fragment', count: 2 }], _entitlement_guard_js_1.isServerOwnedItemId), [{ itemId: 'dungeon-legendary-fragment', count: 2 }, { itemId: 'pet-treat', count: 3 }]);
    });
});
