"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const start_js_1 = require("./start.js");
(0, node_test_1.describe)('Hollow Gate server entry debit', () => {
    (0, node_test_1.it)('consumes exactly one counted Key', () => {
        const next = (0, start_js_1.consumeHollowGateKey)({ itemStacks: [{ itemId: 'hollow-gate-key', count: 2 }, { itemId: 'other', count: 4 }] });
        strict_1.default.deepEqual(next?.itemStacks, [{ itemId: 'hollow-gate-key', count: 1 }, { itemId: 'other', count: 4 }]);
    });
    (0, node_test_1.it)('supports legacy inventory Keys and rejects a missing Key', () => {
        strict_1.default.deepEqual((0, start_js_1.consumeHollowGateKey)({ inventory: ['other', 'hollow-gate-key', 'other'] })?.inventory, ['other', 'other']);
        strict_1.default.equal((0, start_js_1.consumeHollowGateKey)({ inventory: ['other'], itemStacks: [] }), null);
    });
});
