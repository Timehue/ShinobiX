"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const _forge_js_1 = require("./_forge.js");
(0, node_test_1.describe)('server Crafter forge', () => {
    const base = { level: 100, ryo: 10_000, inventory: ['hunt-torn-hide', 'hunt-torn-hide'], itemStacks: [{ itemId: 'weekly-boss-core', count: 10 }] };
    (0, node_test_1.it)('consumes the canonical material pool and grants supplies', () => {
        const out = (0, _forge_js_1.applyForge)(base, 'supply', 'pet-treat', 2);
        strict_1.default.equal((0, _forge_js_1.craftPointTotal)(out), (0, _forge_js_1.craftPointTotal)(base) - 156); // cheapest-first discrete materials overspend the 100-point bill like the client
        strict_1.default.deepEqual(out.itemStacks?.find((s) => s.itemId === 'pet-treat'), { itemId: 'pet-treat', count: 2 });
    });
    (0, node_test_1.it)('rejects unknown recipes and grants only canonical built-in weapons', () => {
        strict_1.default.equal((0, _forge_js_1.applyForge)(base, 'weapon', 'forged-client-item', 1), null);
        const out = (0, _forge_js_1.applyForge)(base, 'weapon', 'ashen-leaf-saber', 1);
        strict_1.default.equal(out.ryo, 9400);
        strict_1.default.ok(out.inventory.includes('ashen-leaf-saber'));
    });
    (0, node_test_1.it)('converts exactly five fragments into one relic', () => {
        const out = (0, _forge_js_1.applyForge)({ itemStacks: [{ itemId: 'dungeon-legendary-fragment', count: 6 }] }, 'relic', 'dungeon-legendary-relic', 1);
        strict_1.default.equal(out.itemStacks.find((s) => s.itemId === 'dungeon-legendary-fragment').count, 1);
        strict_1.default.equal(out.itemStacks.find((s) => s.itemId === 'dungeon-legendary-relic').count, 1);
    });
});
