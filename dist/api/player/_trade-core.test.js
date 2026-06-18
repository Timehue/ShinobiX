"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const _trade_core_js_1 = require("./_trade-core.js");
(0, node_test_1.test)('isTradeCurrency: only the four allowed currencies', () => {
    strict_1.default.equal((0, _trade_core_js_1.isTradeCurrency)('ryo'), true);
    strict_1.default.equal((0, _trade_core_js_1.isTradeCurrency)('fateShards'), true);
    strict_1.default.equal((0, _trade_core_js_1.isTradeCurrency)('boneCharms'), true);
    strict_1.default.equal((0, _trade_core_js_1.isTradeCurrency)('auraStones'), true);
    // Vanguard-locked / top-rarity / non-currency are rejected.
    strict_1.default.equal((0, _trade_core_js_1.isTradeCurrency)('honorSeals'), false);
    strict_1.default.equal((0, _trade_core_js_1.isTradeCurrency)('mythicSeals'), false);
    strict_1.default.equal((0, _trade_core_js_1.isTradeCurrency)('auraDust'), false);
    strict_1.default.equal((0, _trade_core_js_1.isTradeCurrency)('bankRyo'), false);
    strict_1.default.equal((0, _trade_core_js_1.isTradeCurrency)(''), false);
    strict_1.default.equal((0, _trade_core_js_1.isTradeCurrency)(undefined), false);
});
(0, node_test_1.test)('planTrade: burns the tax and credits the rest', () => {
    const plan = (0, _trade_core_js_1.planTrade)('ryo', 100_000, 500_000);
    strict_1.default.equal(plan.ok, true);
    if (!plan.ok)
        return;
    strict_1.default.equal(plan.debit, 100_000);
    strict_1.default.equal(plan.credit, Math.floor(100_000 * (1 - _trade_core_js_1.TRADE_TAX_PCT)));
    strict_1.default.equal(plan.burned, 100_000 - plan.credit);
    // Recipient never gets more than the sender loses.
    strict_1.default.ok(plan.credit + plan.burned === plan.debit);
});
(0, node_test_1.test)('planTrade: tax floors so the burn absorbs the rounding remainder', () => {
    // 1001 ryo at 10% → credit floor(900.9)=900, burn=101 (>10% by the remainder).
    const plan = (0, _trade_core_js_1.planTrade)('ryo', 1001, 1001);
    strict_1.default.equal(plan.ok, true);
    if (!plan.ok)
        return;
    strict_1.default.equal(plan.credit, 900);
    strict_1.default.equal(plan.burned, 101);
    strict_1.default.equal(plan.credit + plan.burned, plan.debit);
});
(0, node_test_1.test)('planTrade: rejects below minimum', () => {
    const plan = (0, _trade_core_js_1.planTrade)('ryo', _trade_core_js_1.TRADE_MINS.ryo - 1, 1_000_000);
    strict_1.default.equal(plan.ok, false);
});
(0, node_test_1.test)('planTrade: rejects above per-transfer cap', () => {
    const plan = (0, _trade_core_js_1.planTrade)('ryo', _trade_core_js_1.TRADE_CAPS.ryo + 1, 10_000_000);
    strict_1.default.equal(plan.ok, false);
});
(0, node_test_1.test)('planTrade: rejects insufficient balance', () => {
    const plan = (0, _trade_core_js_1.planTrade)('fateShards', 50, 49);
    strict_1.default.equal(plan.ok, false);
});
(0, node_test_1.test)('planTrade: accepts a fate-shard transfer at the floor', () => {
    const plan = (0, _trade_core_js_1.planTrade)('fateShards', 10, 10);
    strict_1.default.equal(plan.ok, true);
    if (!plan.ok)
        return;
    strict_1.default.equal(plan.debit, 10);
    strict_1.default.equal(plan.credit, 9); // floor(10 * 0.9)
    strict_1.default.equal(plan.burned, 1);
});
(0, node_test_1.test)('planTrade: rejects a non-tradeable currency', () => {
    const plan = (0, _trade_core_js_1.planTrade)('honorSeals', 10, 10_000);
    strict_1.default.equal(plan.ok, false);
});
(0, node_test_1.test)('planTrade: rejects NaN / non-numeric amount', () => {
    strict_1.default.equal((0, _trade_core_js_1.planTrade)('ryo', 'abc', 1_000_000).ok, false);
    strict_1.default.equal((0, _trade_core_js_1.planTrade)('ryo', NaN, 1_000_000).ok, false);
});
