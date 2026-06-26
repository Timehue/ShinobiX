"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const node_assert_1 = require("node:assert");
const _wanderer_gift_js_1 = require("./_wanderer-gift.js");
(0, node_test_1.describe)("rollWandererGift", () => {
    (0, node_test_1.it)("rolls 0–1 fate shards, 1–5 bone charms, and positive ryo across the rng range", () => {
        for (const r of [() => 0, () => 0.5, () => 0.999]) {
            const g = (0, _wanderer_gift_js_1.rollWandererGift)(40, r);
            node_assert_1.strict.ok(g.fateShards === 0 || g.fateShards === 1, `shards ${g.fateShards}`);
            node_assert_1.strict.ok(g.boneCharms >= 1 && g.boneCharms <= 5, `charms ${g.boneCharms}`);
            node_assert_1.strict.ok(g.ryo > 0, `ryo ${g.ryo}`);
        }
    });
    (0, node_test_1.it)("fate shard is occasional (low rng grants 1, mid rng grants 0)", () => {
        node_assert_1.strict.equal((0, _wanderer_gift_js_1.rollWandererGift)(40, () => 0).fateShards, 1);
        node_assert_1.strict.equal((0, _wanderer_gift_js_1.rollWandererGift)(40, () => 0.5).fateShards, 0);
    });
    (0, node_test_1.it)("ryo scales with level but stays modest", () => {
        const lo = (0, _wanderer_gift_js_1.rollWandererGift)(1, () => 0.5);
        const hi = (0, _wanderer_gift_js_1.rollWandererGift)(100, () => 0.5);
        node_assert_1.strict.ok(hi.ryo > lo.ryo);
        node_assert_1.strict.ok(hi.ryo <= 1500, "ryo stays small");
    });
    (0, node_test_1.it)("clamps junk level", () => {
        node_assert_1.strict.equal((0, _wanderer_gift_js_1.rollWandererGift)(0, () => 0).ryo, (0, _wanderer_gift_js_1.rollWandererGift)(1, () => 0).ryo);
        node_assert_1.strict.equal((0, _wanderer_gift_js_1.rollWandererGift)(9999, () => 0).ryo, (0, _wanderer_gift_js_1.rollWandererGift)(100, () => 0).ryo);
    });
});
(0, node_test_1.describe)("decideWandererGift", () => {
    (0, node_test_1.it)("allows up to the daily cap, then blocks", () => {
        for (let i = 0; i < _wanderer_gift_js_1.WANDERER_GIFTS_PER_DAY; i++)
            node_assert_1.strict.equal((0, _wanderer_gift_js_1.decideWandererGift)(i).ok, true);
        const d = (0, _wanderer_gift_js_1.decideWandererGift)(_wanderer_gift_js_1.WANDERER_GIFTS_PER_DAY);
        node_assert_1.strict.equal(d.ok, false);
        if (!d.ok)
            node_assert_1.strict.equal(d.reason, "daily-cap");
    });
});
