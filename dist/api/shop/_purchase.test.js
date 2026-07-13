"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const node_assert_1 = require("node:assert");
const _purchase_js_1 = require("./_purchase.js");
(0, node_test_1.describe)('catalog shop purchase', () => {
    (0, node_test_1.it)('atomically debits ryo and grants an ordinary catalog item', () => {
        const result = (0, _purchase_js_1.purchaseCatalogItem)({ level: 10, ryo: 1000, inventory: [] }, 'shinobi-vest', 99);
        node_assert_1.strict.equal(result.ok, true);
        if (result.ok) {
            node_assert_1.strict.equal(result.item.qty, 1);
            node_assert_1.strict.equal(result.character.ryo, 820);
            node_assert_1.strict.deepEqual(result.character.inventory, ['shinobi-vest']);
        }
    });
    (0, node_test_1.it)('derives premium currency and stored discounts', () => {
        const result = (0, _purchase_js_1.purchaseCatalogItem)({ level: 100, fateShards: 1000, elderFocus: 'trade', inventory: [] }, 'golden-apple', 1);
        node_assert_1.strict.equal(result.ok, true);
        if (result.ok) {
            node_assert_1.strict.equal(result.item.currency, 'fateShards');
            node_assert_1.strict.equal(result.item.unitCost, 19);
        }
    });
    (0, node_test_1.it)('enforces consumable caps and rejects free reward items', () => {
        const capped = (0, _purchase_js_1.purchaseCatalogItem)({ level: 100, ryo: 100000, inventory: Array(50).fill('item-attack-pill') }, 'item-attack-pill', 5);
        node_assert_1.strict.equal(capped.ok, false);
        node_assert_1.strict.equal((0, _purchase_js_1.purchaseCatalogItem)({ level: 100, ryo: 100000, inventory: [] }, 'dungeon-key', 1).ok, false);
    });
    (0, node_test_1.it)('fails closed on insufficient funds and duplicate gear', () => {
        node_assert_1.strict.equal((0, _purchase_js_1.purchaseCatalogItem)({ level: 100, ryo: 0, inventory: [] }, 'shinobi-vest', 1).ok, false);
        node_assert_1.strict.equal((0, _purchase_js_1.purchaseCatalogItem)({ level: 100, ryo: 1000, inventory: ['shinobi-vest'] }, 'shinobi-vest', 1).ok, false);
    });
});
