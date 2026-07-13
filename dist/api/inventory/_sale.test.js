"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const node_test_1 = __importDefault(require("node:test"));
const _sale_js_1 = require("./_sale.js");
const item = (overrides = {}) => ({
    id: 'sale-item', name: 'Sale Item', slot: 'hand', rarity: 'common', cost: 101, ...overrides,
});
const character = (overrides = {}) => ({
    name: 'rill', ryo: 10, inventory: [], itemStacks: [], equipment: {}, ...overrides,
});
(0, node_test_1.default)('backpack sale consumes stacks before uniques and credits canonical half-cost', () => {
    const sold = (0, _sale_js_1.applyInventorySale)(character({ inventory: ['sale-item', 'other'], itemStacks: [{ itemId: 'sale-item', count: 2 }] }), item(), 'backpack', 3, undefined, 'inventorysale001', 100);
    strict_1.default.equal(sold.ok, true);
    if (!sold.ok)
        return;
    strict_1.default.equal(sold.character.ryo, 160);
    strict_1.default.deepEqual(sold.character.inventory, ['other']);
    strict_1.default.deepEqual(sold.character.itemStacks, []);
    const replay = (0, _sale_js_1.applyInventorySale)(sold.character, item(), 'backpack', 3, undefined, 'inventorysale001', 101);
    strict_1.default.equal(replay.ok, true);
    if (replay.ok)
        strict_1.default.equal(replay.character.ryo, 160);
    const legacy = (0, _sale_js_1.applyInventorySale)(character({ inventory: ['sale-item'], itemStacks: undefined }), item(), 'backpack', 1, undefined, 'inventorysale007', 100);
    strict_1.default.equal(legacy.ok, true);
});
(0, node_test_1.default)('equipped sale requires the exact slot and clears only matching aliases', () => {
    const sold = (0, _sale_js_1.applyInventorySale)(character({ equipment: { hand: 'sale-item', weapon: 'sale-item', gloves: 'keep' } }), item(), 'equipped', 9, 'hand', 'inventorysale002', 100);
    strict_1.default.equal(sold.ok, true);
    if (sold.ok)
        strict_1.default.deepEqual(sold.character.equipment, { gloves: 'keep' });
    strict_1.default.equal((0, _sale_js_1.applyInventorySale)(character({ equipment: { hand: 'other' } }), item(), 'equipped', 1, 'hand', 'inventorysale003', 100).ok, false);
});
(0, node_test_1.default)('sale rejects missing ownership, unsellable items, invalid balances, and request conflicts', () => {
    strict_1.default.equal((0, _sale_js_1.applyInventorySale)(character(), item(), 'backpack', 1, undefined, 'inventorysale004', 100).ok, false);
    strict_1.default.equal((0, _sale_js_1.applyInventorySale)(character({ inventory: ['sale-item'] }), item({ cost: 0 }), 'backpack', 1, undefined, 'inventorysale005', 100).ok, false);
    strict_1.default.equal((0, _sale_js_1.applyInventorySale)(character({ ryo: -1, inventory: ['sale-item'] }), item(), 'backpack', 1, undefined, 'inventorysale006', 100).ok, false);
});
(0, node_test_1.default)('sale route and inventory screen use authenticated locked settlement', () => {
    const route = (0, node_fs_1.readFileSync)((0, node_path_1.join)(process.cwd(), 'api', 'inventory', 'sell.ts'), 'utf8');
    const helper = (0, node_fs_1.readFileSync)((0, node_path_1.join)(process.cwd(), 'shinobij.client', 'src', 'lib', 'shop-settlement.ts'), 'utf8');
    const screen = (0, node_fs_1.readFileSync)((0, node_path_1.join)(process.cwd(), 'shinobij.client', 'src', 'screens', 'Inventory.tsx'), 'utf8');
    strict_1.default.match(route, /await authedPlayer\(req, playerName\)/);
    strict_1.default.match(route, /await mutatePlayerSave\(playerName/);
    strict_1.default.match(route, /strict: true/);
    strict_1.default.match(helper, /'\/api\/inventory\/sell'/);
    strict_1.default.match(screen, /settleInventorySale\(character\.name/);
    strict_1.default.match(screen, /updateCharacter\(result\.character\)/);
});
