"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const _sale_js_1 = require("./_sale.js");
(0, node_test_1.describe)('server shop sale', () => {
    (0, node_test_1.it)('removes owned catalog items and credits canonical half-price ryo', () => {
        const out = (0, _sale_js_1.sellCatalogItem)({ ryo: 10, inventory: ['ashen-leaf-saber'] }, 'ashen-leaf-saber', 1);
        strict_1.default.equal(out.ok, true);
        if (!out.ok)
            return;
        strict_1.default.deepEqual(out.character.inventory, []);
        strict_1.default.equal(out.character.ryo, 250);
    });
    (0, node_test_1.it)('rejects forged/absent items and verifies equipped slots', () => {
        strict_1.default.equal((0, _sale_js_1.sellCatalogItem)({ ryo: 0 }, 'forged-item', 1).ok, false);
        strict_1.default.equal((0, _sale_js_1.sellCatalogItem)({ equipment: { hand: 'other' } }, 'ashen-leaf-saber', 1, 'hand').ok, false);
        const out = (0, _sale_js_1.sellCatalogItem)({ ryo: 0, equipment: { hand: 'ashen-leaf-saber', weapon: 'ashen-leaf-saber' } }, 'ashen-leaf-saber', 1, 'hand');
        strict_1.default.equal(out.ok, true);
        if (out.ok)
            strict_1.default.equal(out.character.equipment.hand, undefined);
    });
});
