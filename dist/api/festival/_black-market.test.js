"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const _black_market_js_1 = require("./_black-market.js");
// A deterministic rng that yields a fixed first value (tier pick) then mid-range
// values for the payout sizing calls.
function seeded(first, rest = 0.5) {
    let used = false;
    return () => { if (!used) {
        used = true;
        return first;
    } return rest; };
}
(0, node_test_1.test)('tier boundaries map to the documented odds', () => {
    strict_1.default.equal((0, _black_market_js_1.rollBlackMarket)(seeded(0.00)).tier, 'scraps');
    strict_1.default.equal((0, _black_market_js_1.rollBlackMarket)(seeded(0.49)).tier, 'scraps');
    strict_1.default.equal((0, _black_market_js_1.rollBlackMarket)(seeded(0.50)).tier, 'trinket');
    strict_1.default.equal((0, _black_market_js_1.rollBlackMarket)(seeded(0.71)).tier, 'trinket');
    strict_1.default.equal((0, _black_market_js_1.rollBlackMarket)(seeded(0.72)).tier, 'haul');
    strict_1.default.equal((0, _black_market_js_1.rollBlackMarket)(seeded(0.86)).tier, 'haul');
    strict_1.default.equal((0, _black_market_js_1.rollBlackMarket)(seeded(0.87)).tier, 'relic');
    strict_1.default.equal((0, _black_market_js_1.rollBlackMarket)(seeded(0.94)).tier, 'relic');
    strict_1.default.equal((0, _black_market_js_1.rollBlackMarket)(seeded(0.95)).tier, 'fortune');
    strict_1.default.equal((0, _black_market_js_1.rollBlackMarket)(seeded(0.98)).tier, 'fortune');
    strict_1.default.equal((0, _black_market_js_1.rollBlackMarket)(seeded(0.99)).tier, 'jackpot');
    strict_1.default.equal((0, _black_market_js_1.rollBlackMarket)(seeded(0.999)).tier, 'jackpot');
});
(0, node_test_1.test)('payouts stay within their advertised ranges', () => {
    const scraps = (0, _black_market_js_1.rollBlackMarket)(seeded(0.0, 0.0));
    strict_1.default.ok(scraps.ryo >= 4_000 && scraps.ryo <= 12_000);
    const scrapsMax = (0, _black_market_js_1.rollBlackMarket)(seeded(0.0, 0.999));
    strict_1.default.ok(scrapsMax.ryo >= 4_000 && scrapsMax.ryo <= 12_000);
    const haul = (0, _black_market_js_1.rollBlackMarket)(seeded(0.8, 0.999));
    strict_1.default.ok(haul.ryo >= 22_000 && haul.ryo <= 38_000);
    const relic = (0, _black_market_js_1.rollBlackMarket)(seeded(0.9, 0.999));
    strict_1.default.ok(relic.boneCharms >= 4 && relic.boneCharms <= 8);
    strict_1.default.ok(relic.auraStones >= 2 && relic.auraStones <= 4);
    const jackpot = (0, _black_market_js_1.rollBlackMarket)(seeded(0.999));
    strict_1.default.equal(jackpot.ryo, 50_000);
    strict_1.default.equal(jackpot.fateShards, 10);
    strict_1.default.equal(jackpot.mythicSeals, 1);
});
(0, node_test_1.test)('is a net ryo sink: expected ryo return is well under cost', () => {
    // Monte-Carlo with a simple LCG so the average is stable and deterministic.
    let s = 123456789;
    const rng = () => { s = (1103515245 * s + 12345) & 0x7fffffff; return s / 0x7fffffff; };
    const N = 200_000;
    let ryoOut = 0;
    for (let i = 0; i < N; i++)
        ryoOut += (0, _black_market_js_1.rollBlackMarket)(rng).ryo;
    const avgRyo = ryoOut / N;
    // Expected ryo payout should be clearly below the 25k cost (it's a sink).
    strict_1.default.ok(avgRyo < _black_market_js_1.BLACK_MARKET_COST * 0.7, `avg ryo ${avgRyo} should be < ${_black_market_js_1.BLACK_MARKET_COST * 0.7}`);
});
