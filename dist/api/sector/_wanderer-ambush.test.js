"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const node_assert_1 = require("node:assert");
const _wanderer_ambush_js_1 = require("./_wanderer-ambush.js");
(0, node_test_1.describe)("rollAmbushReward", () => {
    (0, node_test_1.it)("rolls 1–3 fate shards, 5–10 bone charms, positive ryo across the rng range", () => {
        for (const r of [() => 0, () => 0.5, () => 0.999]) {
            const g = (0, _wanderer_ambush_js_1.rollAmbushReward)(50, r);
            node_assert_1.strict.ok(g.fateShards >= 1 && g.fateShards <= 3, `shards ${g.fateShards}`);
            node_assert_1.strict.ok(g.boneCharms >= 5 && g.boneCharms <= 10, `charms ${g.boneCharms}`);
            node_assert_1.strict.ok(g.ryo > 0, `ryo ${g.ryo}`);
        }
    });
    (0, node_test_1.it)("ryo scales with level and stays reasonable", () => {
        node_assert_1.strict.ok((0, _wanderer_ambush_js_1.rollAmbushReward)(100, () => 0.5).ryo > (0, _wanderer_ambush_js_1.rollAmbushReward)(1, () => 0.5).ryo);
        node_assert_1.strict.ok((0, _wanderer_ambush_js_1.rollAmbushReward)(100, () => 0.999).ryo <= 3000);
    });
});
(0, node_test_1.describe)("ambushCleared", () => {
    (0, node_test_1.it)("requires the full gauntlet's worth of kills since baseline", () => {
        node_assert_1.strict.equal((0, _wanderer_ambush_js_1.ambushCleared)(10, 10 + _wanderer_ambush_js_1.AMBUSH_KILLS_REQUIRED - 1), false);
        node_assert_1.strict.equal((0, _wanderer_ambush_js_1.ambushCleared)(10, 10 + _wanderer_ambush_js_1.AMBUSH_KILLS_REQUIRED), true);
        node_assert_1.strict.equal((0, _wanderer_ambush_js_1.ambushCleared)(10, 100), true);
        node_assert_1.strict.equal((0, _wanderer_ambush_js_1.ambushCleared)(10, 9), false);
    });
});
