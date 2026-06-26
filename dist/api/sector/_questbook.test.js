"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const node_assert_1 = require("node:assert");
const _questbook_js_1 = require("./_questbook.js");
const VALID_METRICS = new Set(["totalAiKills", "totalPetWins", "cardClashWins", "totalTilesExplored"]);
(0, node_test_1.describe)("QUEST_BOOK catalog", () => {
    (0, node_test_1.it)("every epic is well-formed: ordered stages, known metrics, valid choice/counter shape", () => {
        node_assert_1.strict.ok(Object.keys(_questbook_js_1.QUEST_BOOK).length >= 3, "has variety");
        for (const [id, q] of Object.entries(_questbook_js_1.QUEST_BOOK)) {
            node_assert_1.strict.equal(q.id, id, `${id} id mirrors key`);
            node_assert_1.strict.ok(q.stages.length >= 2, `${id} is multi-stage`);
            node_assert_1.strict.ok(q.bandMin >= 1 && q.bandMax <= 100 && q.bandMin <= q.bandMax, `${id} band`);
            node_assert_1.strict.ok(q.weight >= 1 && q.fateShards >= 0 && q.award, `${id} reward fields`);
            const keys = new Set();
            for (const s of q.stages) {
                node_assert_1.strict.ok(VALID_METRICS.has(s.metric), `${id}/${s.key} metric`);
                node_assert_1.strict.ok(s.text.length > 0, `${id}/${s.key} text`);
                node_assert_1.strict.ok(!keys.has(s.key), `${id} duplicate stage key ${s.key}`);
                keys.add(s.key);
                if ((0, _questbook_js_1.stageIsChoice)(s)) {
                    // a branch: needs >= 2 distinct, labelled options; no counter required
                    const optKeys = new Set();
                    node_assert_1.strict.ok(s.choice.options.length >= 2, `${id}/${s.key} choice options`);
                    for (const o of s.choice.options) {
                        node_assert_1.strict.ok(o.label && o.blurb, `${id}/${s.key}/${o.key} option text`);
                        node_assert_1.strict.ok(!optKeys.has(o.key), `${id}/${s.key} dup option ${o.key}`);
                        optKeys.add(o.key);
                    }
                }
                else {
                    node_assert_1.strict.ok(s.count >= 1, `${id}/${s.key} count`);
                }
                if (s.timer) {
                    node_assert_1.strict.ok(s.timer.durationMs > 0, `${id}/${s.key} timer duration`);
                    if (typeof s.timer.failResetToStage === "number") {
                        node_assert_1.strict.ok(s.timer.failResetToStage >= 0 && s.timer.failResetToStage < q.stages.length, `${id}/${s.key} reset target in range`);
                    }
                }
            }
        }
    });
});
(0, node_test_1.describe)("lookup helpers", () => {
    (0, node_test_1.it)("resolves ids/stages and rejects junk / proto pollution", () => {
        node_assert_1.strict.equal((0, _questbook_js_1.isQuestBookId)("qb-bell"), true);
        node_assert_1.strict.equal((0, _questbook_js_1.isQuestBookId)("nope"), false);
        node_assert_1.strict.equal((0, _questbook_js_1.isQuestBookId)("__proto__"), false);
        node_assert_1.strict.equal((0, _questbook_js_1.questBookEntry)("__proto__"), null);
        node_assert_1.strict.equal((0, _questbook_js_1.questBookEntry)("qb-bell")?.title, "The Bell That Doesn't Ring");
        node_assert_1.strict.equal((0, _questbook_js_1.questStage)("qb-bell", 0)?.key, "thief");
        node_assert_1.strict.equal((0, _questbook_js_1.questStage)("qb-bell", 99), null);
        node_assert_1.strict.equal((0, _questbook_js_1.questStage)("qb-bell", -1), null);
        node_assert_1.strict.equal((0, _questbook_js_1.finalStageIndex)(_questbook_js_1.QUEST_BOOK["qb-bell"]), _questbook_js_1.QUEST_BOOK["qb-bell"].stages.length - 1);
    });
});
(0, node_test_1.describe)("questStageComplete", () => {
    (0, node_test_1.it)("is met only when current − baseline reaches count", () => {
        node_assert_1.strict.equal((0, _questbook_js_1.questStageComplete)(10, 12, 3), false);
        node_assert_1.strict.equal((0, _questbook_js_1.questStageComplete)(10, 13, 3), true);
        node_assert_1.strict.equal((0, _questbook_js_1.questStageComplete)(10, 9, 3), false);
        node_assert_1.strict.equal((0, _questbook_js_1.questStageComplete)(0, 1, 1), true);
    });
});
(0, node_test_1.describe)("branch (choice) helpers", () => {
    const bell = _questbook_js_1.QUEST_BOOK["qb-bell"];
    const curse = bell.stages.find(s => s.key === "curse");
    (0, node_test_1.it)("identifies choice stages and resolves options", () => {
        node_assert_1.strict.equal((0, _questbook_js_1.stageIsChoice)(curse), true);
        node_assert_1.strict.equal((0, _questbook_js_1.stageIsChoice)(bell.stages[0]), false);
        node_assert_1.strict.equal((0, _questbook_js_1.choiceOption)(curse, "raw")?.bossStatBonus, 4);
        node_assert_1.strict.equal((0, _questbook_js_1.choiceOption)(curse, "cleanse")?.bossStatBonus, undefined);
        node_assert_1.strict.equal((0, _questbook_js_1.choiceOption)(curse, "nope"), null);
        node_assert_1.strict.equal((0, _questbook_js_1.choiceOption)(bell.stages[0], "raw"), null);
    });
    (0, node_test_1.it)("aggregates sealed choices into reward modifiers", () => {
        const raw = (0, _questbook_js_1.aggregateChoiceEffects)(bell, { curse: "raw" });
        node_assert_1.strict.equal(raw.bonusFateShards, 1);
        node_assert_1.strict.deepEqual(raw.standings, ["bell-raw"]);
        const cleanse = (0, _questbook_js_1.aggregateChoiceEffects)(bell, { curse: "cleanse" });
        node_assert_1.strict.equal(cleanse.bonusFateShards, 0);
        node_assert_1.strict.equal(cleanse.ryoMult, 1);
        const caravan = _questbook_js_1.QUEST_BOOK["qb-caravan"];
        const exec = (0, _questbook_js_1.aggregateChoiceEffects)(caravan, { judgment: "execute" });
        node_assert_1.strict.ok(Math.abs(exec.ryoMult - 1.5) < 1e-9, "execute = +50% ryo");
        node_assert_1.strict.deepEqual(exec.standings, ["goro-executed"]);
        const none = (0, _questbook_js_1.aggregateChoiceEffects)(bell, {});
        node_assert_1.strict.equal(none.ryoMult, 1);
        node_assert_1.strict.equal(none.titleOverride, null);
    });
});
(0, node_test_1.describe)("timer helpers", () => {
    const bell = _questbook_js_1.QUEST_BOOK["qb-bell"];
    const carryIdx = bell.stages.findIndex(s => s.key === "carry");
    (0, node_test_1.it)("reads the timed-stage window + reset target", () => {
        node_assert_1.strict.ok((0, _questbook_js_1.stageTimerMs)(bell.stages[carryIdx]) > 0, "carry is timed");
        node_assert_1.strict.equal((0, _questbook_js_1.stageTimerMs)(bell.stages[0]), 0, "thief is untimed");
        node_assert_1.strict.equal((0, _questbook_js_1.timerResetStage)(bell, carryIdx), carryIdx, "carry resets to itself");
        node_assert_1.strict.equal((0, _questbook_js_1.timerResetStage)(bell, 0), 0, "untimed stage resets to itself");
    });
});
(0, node_test_1.describe)("bandMatches", () => {
    (0, node_test_1.it)("respects the inclusive level band", () => {
        const bell = _questbook_js_1.QUEST_BOOK["qb-bell"];
        node_assert_1.strict.equal((0, _questbook_js_1.bandMatches)(bell, bell.bandMin), true);
        node_assert_1.strict.equal((0, _questbook_js_1.bandMatches)(bell, bell.bandMax), true);
        node_assert_1.strict.equal((0, _questbook_js_1.bandMatches)(bell, bell.bandMin - 1), false);
        node_assert_1.strict.equal((0, _questbook_js_1.bandMatches)(bell, bell.bandMax + 1), false);
    });
});
(0, node_test_1.describe)("questBookRyo", () => {
    (0, node_test_1.it)("scales with level + weight and stays in an epic-but-sane range", () => {
        node_assert_1.strict.ok((0, _questbook_js_1.questBookRyo)(40, 8) > (0, _questbook_js_1.questBookRyo)(20, 8), "scales with level");
        node_assert_1.strict.ok((0, _questbook_js_1.questBookRyo)(40, 9) > (0, _questbook_js_1.questBookRyo)(40, 7), "scales with weight");
        node_assert_1.strict.ok((0, _questbook_js_1.questBookRyo)(100, 20) <= 12000, "capped sane");
        node_assert_1.strict.equal((0, _questbook_js_1.questBookRyo)(0, 8), (0, _questbook_js_1.questBookRyo)(1, 8), "clamps junk level");
    });
});
