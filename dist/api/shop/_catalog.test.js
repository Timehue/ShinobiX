"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const _item_catalog_js_1 = require("../pvp/_item-catalog.js");
const _catalog_js_1 = require("./_catalog.js");
(0, node_test_1.default)('settlement catalog trusts built-ins, merges admin content, and honors deletions', () => {
    const builtinId = Object.keys(_item_catalog_js_1.ITEM_CATALOG)[0];
    const catalogs = (0, _catalog_js_1.buildSettlementCatalogs)([
        {
            creatorItems: [
                { id: builtinId, name: 'forged override', slot: 'hand', rarity: 'legendary', cost: 1 },
                { id: 'admin-item', name: 'Admin Item', slot: 'item', rarity: 'common', cost: 40 },
            ],
            creatorCards: [{ id: 'admin-card', rarity: 'epic' }],
        },
        {
            creatorItems: [{ id: 'admin-item', name: '__ADMIN_DELETED_ITEM__' }],
            creatorCards: [{ id: 'admin-card', rarity: 'legendary' }],
        },
    ]);
    strict_1.default.equal(catalogs.items.get(builtinId)?.name, _item_catalog_js_1.ITEM_CATALOG[builtinId].name);
    strict_1.default.equal(catalogs.items.has('admin-item'), false);
    strict_1.default.equal(catalogs.cards.get('admin-card')?.rarity, 'legendary');
});
(0, node_test_1.default)('invalid admin prices and slots never enter the authoritative catalog', () => {
    const catalogs = (0, _catalog_js_1.buildSettlementCatalogs)([{ creatorItems: [
                { id: 'negative', name: 'Bad', slot: 'hand', rarity: 'common', cost: -1 },
                { id: 'wrong-slot', name: 'Bad', slot: 'wallet', rarity: 'common', cost: 10 },
            ] }]);
    strict_1.default.equal(catalogs.items.has('negative'), false);
    strict_1.default.equal(catalogs.items.has('wrong-slot'), false);
});
