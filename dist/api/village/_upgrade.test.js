"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const node_assert_1 = require("node:assert");
const _upgrade_js_1 = require("./_upgrade.js");
(0, node_test_1.describe)('village upgrade authority', () => { (0, node_test_1.it)('matches the client curve and atomically spends seals', () => { node_assert_1.strict.equal((0, _upgrade_js_1.villageUpgradeCostServer)('training', 0), 10); const out = (0, _upgrade_js_1.purchaseVillageUpgrade)({ honorSeals: 100, villageUpgrades: { training: 0 } }, 'training'); node_assert_1.strict.equal(out.ok, true); if (out.ok) {
    node_assert_1.strict.equal(out.character.honorSeals, 90);
    node_assert_1.strict.deepEqual(out.character.villageUpgrades, { training: 1 });
} }); (0, node_test_1.it)('enforces funds and cap', () => { node_assert_1.strict.equal((0, _upgrade_js_1.purchaseVillageUpgrade)({ honorSeals: 0 }, 'shop').ok, false); node_assert_1.strict.equal((0, _upgrade_js_1.purchaseVillageUpgrade)({ honorSeals: 99999, villageUpgrades: { shop: 50 } }, 'shop').ok, false); }); });
