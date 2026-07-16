"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = require("node:test");
const forge_elemental_core_js_1 = require("./forge-elemental-core.js");
(0, node_test_1.describe)('Elemental Core forging', () => {
    (0, node_test_1.it)('atomically converts ten stacked shards into one counted core', () => {
        const result = (0, forge_elemental_core_js_1.forgeElementalCore)({
            inventory: [],
            itemStacks: [{ itemId: 'elemental-shard', count: 12 }],
        });
        strict_1.default.equal(result.ok, true);
        if (!result.ok)
            return;
        strict_1.default.deepEqual(result.character.itemStacks, [
            { itemId: 'elemental-shard', count: 2 },
            { itemId: 'elemental-core', count: 1 },
        ]);
        strict_1.default.equal(result.value.shardsSpent, forge_elemental_core_js_1.ELEMENTAL_SHARDS_PER_CORE);
    });
    (0, node_test_1.it)('supports legacy inline shards and refuses an insufficient balance', () => {
        const forged = (0, forge_elemental_core_js_1.forgeElementalCore)({
            inventory: Array.from({ length: 10 }, () => 'elemental-shard'),
            itemStacks: [{ itemId: 'elemental-core', count: 2 }],
        });
        strict_1.default.equal(forged.ok, true);
        if (forged.ok) {
            strict_1.default.deepEqual(forged.character.inventory, []);
            strict_1.default.deepEqual(forged.character.itemStacks, [{ itemId: 'elemental-core', count: 3 }]);
        }
        strict_1.default.equal((0, forge_elemental_core_js_1.forgeElementalCore)({ inventory: ['elemental-shard'], itemStacks: [] }).ok, false);
    });
});
