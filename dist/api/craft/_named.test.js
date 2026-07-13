"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const _named_js_1 = require("./_named.js");
(0, node_test_1.describe)('named forge authority', () => {
    (0, node_test_1.it)('debits the canonical 1000-point premium pool and rejects insufficient funds', () => {
        strict_1.default.equal((0, _named_js_1.debitNamedForge)({ boneCharms: 199 }), null);
        strict_1.default.equal((0, _named_js_1.debitNamedForge)({ boneCharms: 200 })?.boneCharms, 0);
        const mixed = (0, _named_js_1.debitNamedForge)({ boneCharms: 100, auraStones: 20 });
        strict_1.default.equal(mixed.boneCharms, 0);
        strict_1.default.equal(mixed.auraStones, 0);
    });
    (0, node_test_1.it)('builds combat fields only from the sealed roll', () => {
        const item = (0, _named_js_1.buildNamedItem)({ kind: 'weapon', ep: 31, range: 4, offenseVal: 170, tags: [{ name: 'Wound', percent: 36 }] }, 'Blade', 'Lore');
        strict_1.default.equal(item.weaponEp, 31);
        strict_1.default.equal(item.apCost, 40);
        strict_1.default.equal(item.bonuses.ninjutsuOffense, 170);
    });
});
