"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const node_assert_1 = require("node:assert");
const _wanderer_quest_js_1 = require("./_wanderer-quest.js");
const VALID_METRICS = new Set(["totalAiKills", "totalPetWins", "cardClashWins", "totalTilesExplored"]);
(0, node_test_1.describe)("WANDERER_QUESTS catalog", () => {
    (0, node_test_1.it)("every entry has a known metric + positive target/weight", () => {
        for (const [id, def] of Object.entries(_wanderer_quest_js_1.WANDERER_QUESTS)) {
            node_assert_1.strict.ok(VALID_METRICS.has(def.metric), `${id} metric`);
            node_assert_1.strict.ok(def.target >= 1, `${id} target`);
            node_assert_1.strict.ok(def.weight >= 1, `${id} weight`);
        }
        node_assert_1.strict.ok(Object.keys(_wanderer_quest_js_1.WANDERER_QUESTS).length >= 4, "has variety");
    });
});
(0, node_test_1.describe)("isWandererQuestId", () => {
    (0, node_test_1.it)("accepts catalog ids and rejects others", () => {
        for (const id of Object.keys(_wanderer_quest_js_1.WANDERER_QUESTS))
            node_assert_1.strict.equal((0, _wanderer_quest_js_1.isWandererQuestId)(id), true);
        node_assert_1.strict.equal((0, _wanderer_quest_js_1.isWandererQuestId)("nope"), false);
        node_assert_1.strict.equal((0, _wanderer_quest_js_1.isWandererQuestId)("__proto__"), false);
    });
});
(0, node_test_1.describe)("wandererQuestRyo", () => {
    (0, node_test_1.it)("scales with level and effort weight, stays modest", () => {
        node_assert_1.strict.ok((0, _wanderer_quest_js_1.wandererQuestRyo)(1, 3) > 0);
        node_assert_1.strict.ok((0, _wanderer_quest_js_1.wandererQuestRyo)(50, 6) > (0, _wanderer_quest_js_1.wandererQuestRyo)(20, 3));
        node_assert_1.strict.ok((0, _wanderer_quest_js_1.wandererQuestRyo)(100, 6) <= 3000);
    });
    (0, node_test_1.it)("clamps junk input", () => {
        node_assert_1.strict.equal((0, _wanderer_quest_js_1.wandererQuestRyo)(0, 3), (0, _wanderer_quest_js_1.wandererQuestRyo)(1, 3));
        node_assert_1.strict.equal((0, _wanderer_quest_js_1.wandererQuestRyo)(9999, 3), (0, _wanderer_quest_js_1.wandererQuestRyo)(100, 3));
    });
});
(0, node_test_1.describe)("wandererQuestComplete", () => {
    (0, node_test_1.it)("is met only when current − baseline reaches target", () => {
        node_assert_1.strict.equal((0, _wanderer_quest_js_1.wandererQuestComplete)(10, 12, 3), false);
        node_assert_1.strict.equal((0, _wanderer_quest_js_1.wandererQuestComplete)(10, 13, 3), true);
        node_assert_1.strict.equal((0, _wanderer_quest_js_1.wandererQuestComplete)(10, 9, 3), false);
    });
});
