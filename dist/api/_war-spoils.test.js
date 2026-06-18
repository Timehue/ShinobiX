"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const node_assert_1 = require("node:assert");
const _war_spoils_js_1 = require("./_war-spoils.js");
(0, node_test_1.describe)("computeSpoils", () => {
    (0, node_test_1.it)("takes 15% of ryo + honor seals and 10% of fate shards (floored)", () => {
        const s = (0, _war_spoils_js_1.computeSpoils)({ ryo: 100_000, honorSeals: 200, fateShards: 95 });
        node_assert_1.strict.equal(s.ryo, Math.floor(100_000 * _war_spoils_js_1.SPOILS_CURRENCY_PCT)); // 15,000
        node_assert_1.strict.equal(s.honorSeals, Math.floor(200 * _war_spoils_js_1.SPOILS_CURRENCY_PCT)); // 30
        node_assert_1.strict.equal(s.fateShards, Math.floor(95 * _war_spoils_js_1.SPOILS_FATE_PCT)); // 9
    });
    (0, node_test_1.it)("is uncapped — scales straight with the loser's holdings", () => {
        node_assert_1.strict.equal((0, _war_spoils_js_1.computeSpoils)({ ryo: 10_000_000 }).ryo, 1_500_000);
    });
    (0, node_test_1.it)("never goes negative and treats missing/garbage as 0", () => {
        node_assert_1.strict.deepEqual((0, _war_spoils_js_1.computeSpoils)({}), { ryo: 0, honorSeals: 0, fateShards: 0 });
        node_assert_1.strict.deepEqual((0, _war_spoils_js_1.computeSpoils)({ ryo: -50, honorSeals: NaN }), { ryo: 0, honorSeals: 0, fateShards: 0 });
    });
});
(0, node_test_1.describe)("bumpStanding", () => {
    (0, node_test_1.it)("increments the right counter and stamps lastResult", () => {
        const a = (0, _war_spoils_js_1.bumpStanding)(null, "win", 100);
        node_assert_1.strict.deepEqual({ wins: a.wins, losses: a.losses, lastResult: a.lastResult }, { wins: 1, losses: 0, lastResult: "win" });
        const b = (0, _war_spoils_js_1.bumpStanding)(a, "loss", 200);
        node_assert_1.strict.deepEqual({ wins: b.wins, losses: b.losses, lastResult: b.lastResult, updatedAt: b.updatedAt }, { wins: 1, losses: 1, lastResult: "loss", updatedAt: 200 });
    });
});
