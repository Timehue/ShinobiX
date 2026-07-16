"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = require("node:test");
const _attunement_js_1 = require("./_attunement.js");
(0, node_test_1.describe)('Hollow Gate attunement settlement', () => {
    (0, node_test_1.test)('charges the server-derived next-rank cost', () => {
        const first = (0, _attunement_js_1.buyHollowGateAttunement)({ hollowShards: 100 }, 'seasoned-delver');
        strict_1.default.equal(first.ok, true);
        if (!first.ok)
            return;
        strict_1.default.equal(first.cost, 30);
        strict_1.default.equal(first.character.hollowShards, 70);
        const second = (0, _attunement_js_1.buyHollowGateAttunement)(first.character, 'seasoned-delver');
        strict_1.default.equal(second.ok, true);
        if (!second.ok)
            return;
        strict_1.default.equal(second.cost, 60);
        strict_1.default.equal(second.character.hollowGateAttunement['seasoned-delver'], 2);
    });
    (0, node_test_1.test)('rejects unknown, maxed, and unaffordable purchases', () => {
        strict_1.default.equal((0, _attunement_js_1.buyHollowGateAttunement)({ hollowShards: 999 }, 'unknown').ok, false);
        strict_1.default.equal((0, _attunement_js_1.buyHollowGateAttunement)({ hollowShards: 999, hollowGateAttunement: { cartographer: 1 } }, 'cartographer').ok, false);
        strict_1.default.equal((0, _attunement_js_1.buyHollowGateAttunement)({ hollowShards: 29 }, 'seasoned-delver').ok, false);
    });
});
