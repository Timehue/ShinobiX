import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
    QUEST_BOOK,
    isQuestBookId,
    questBookEntry,
    questStage,
    finalStageIndex,
    questStageComplete,
    stageIsChoice,
    choiceOption,
    stageTimerMs,
    timerResetStage,
    bandMatches,
    questBookRyo,
    aggregateChoiceEffects,
} from "./_questbook.js";

const VALID_METRICS = new Set(["totalAiKills", "totalPetWins", "cardClashWins", "totalTilesExplored"]);

describe("QUEST_BOOK catalog", () => {
    it("every epic is well-formed: ordered stages, known metrics, valid choice/counter shape", () => {
        assert.ok(Object.keys(QUEST_BOOK).length >= 3, "has variety");
        for (const [id, q] of Object.entries(QUEST_BOOK)) {
            assert.equal(q.id, id, `${id} id mirrors key`);
            assert.ok(q.stages.length >= 2, `${id} is multi-stage`);
            assert.ok(q.bandMin >= 1 && q.bandMax <= 100 && q.bandMin <= q.bandMax, `${id} band`);
            assert.ok(q.weight >= 1 && q.fateShards >= 0 && q.award, `${id} reward fields`);
            const keys = new Set<string>();
            for (const s of q.stages) {
                assert.ok(VALID_METRICS.has(s.metric), `${id}/${s.key} metric`);
                assert.ok(s.text.length > 0, `${id}/${s.key} text`);
                assert.ok(!keys.has(s.key), `${id} duplicate stage key ${s.key}`);
                keys.add(s.key);
                if (stageIsChoice(s)) {
                    // a branch: needs >= 2 distinct, labelled options; no counter required
                    const optKeys = new Set<string>();
                    assert.ok(s.choice!.options.length >= 2, `${id}/${s.key} choice options`);
                    for (const o of s.choice!.options) {
                        assert.ok(o.label && o.blurb, `${id}/${s.key}/${o.key} option text`);
                        assert.ok(!optKeys.has(o.key), `${id}/${s.key} dup option ${o.key}`);
                        optKeys.add(o.key);
                    }
                } else {
                    assert.ok(s.count >= 1, `${id}/${s.key} count`);
                }
                if (s.timer) {
                    assert.ok(s.timer.durationMs > 0, `${id}/${s.key} timer duration`);
                    if (typeof s.timer.failResetToStage === "number") {
                        assert.ok(s.timer.failResetToStage >= 0 && s.timer.failResetToStage < q.stages.length, `${id}/${s.key} reset target in range`);
                    }
                }
            }
        }
    });
});

describe("lookup helpers", () => {
    it("resolves ids/stages and rejects junk / proto pollution", () => {
        assert.equal(isQuestBookId("qb-bell"), true);
        assert.equal(isQuestBookId("nope"), false);
        assert.equal(isQuestBookId("__proto__"), false);
        assert.equal(questBookEntry("__proto__"), null);
        assert.equal(questBookEntry("qb-bell")?.title, "The Bell That Doesn't Ring");
        assert.equal(questStage("qb-bell", 0)?.key, "thief");
        assert.equal(questStage("qb-bell", 99), null);
        assert.equal(questStage("qb-bell", -1), null);
        assert.equal(finalStageIndex(QUEST_BOOK["qb-bell"]), QUEST_BOOK["qb-bell"].stages.length - 1);
    });
});

describe("questStageComplete", () => {
    it("is met only when current − baseline reaches count", () => {
        assert.equal(questStageComplete(10, 12, 3), false);
        assert.equal(questStageComplete(10, 13, 3), true);
        assert.equal(questStageComplete(10, 9, 3), false);
        assert.equal(questStageComplete(0, 1, 1), true);
    });
});

describe("branch (choice) helpers", () => {
    const bell = QUEST_BOOK["qb-bell"];
    const curse = bell.stages.find(s => s.key === "curse")!;
    it("identifies choice stages and resolves options", () => {
        assert.equal(stageIsChoice(curse), true);
        assert.equal(stageIsChoice(bell.stages[0]), false);
        assert.equal(choiceOption(curse, "raw")?.bossStatBonus, 4);
        assert.equal(choiceOption(curse, "cleanse")?.bossStatBonus, undefined);
        assert.equal(choiceOption(curse, "nope"), null);
        assert.equal(choiceOption(bell.stages[0], "raw"), null);
    });
    it("aggregates sealed choices into reward modifiers", () => {
        const raw = aggregateChoiceEffects(bell, { curse: "raw" });
        assert.equal(raw.bonusFateShards, 1);
        assert.deepEqual(raw.standings, ["bell-raw"]);
        const cleanse = aggregateChoiceEffects(bell, { curse: "cleanse" });
        assert.equal(cleanse.bonusFateShards, 0);
        assert.equal(cleanse.ryoMult, 1);
        const caravan = QUEST_BOOK["qb-caravan"];
        const exec = aggregateChoiceEffects(caravan, { judgment: "execute" });
        assert.ok(Math.abs(exec.ryoMult - 1.5) < 1e-9, "execute = +50% ryo");
        assert.deepEqual(exec.standings, ["goro-executed"]);
        const none = aggregateChoiceEffects(bell, {});
        assert.equal(none.ryoMult, 1);
        assert.equal(none.titleOverride, null);
    });
});

describe("timer helpers", () => {
    const bell = QUEST_BOOK["qb-bell"];
    const carryIdx = bell.stages.findIndex(s => s.key === "carry");
    it("reads the timed-stage window + reset target", () => {
        assert.ok(stageTimerMs(bell.stages[carryIdx]) > 0, "carry is timed");
        assert.equal(stageTimerMs(bell.stages[0]), 0, "thief is untimed");
        assert.equal(timerResetStage(bell, carryIdx), carryIdx, "carry resets to itself");
        assert.equal(timerResetStage(bell, 0), 0, "untimed stage resets to itself");
    });
});

describe("bandMatches", () => {
    it("respects the inclusive level band", () => {
        const bell = QUEST_BOOK["qb-bell"];
        assert.equal(bandMatches(bell, bell.bandMin), true);
        assert.equal(bandMatches(bell, bell.bandMax), true);
        assert.equal(bandMatches(bell, bell.bandMin - 1), false);
        assert.equal(bandMatches(bell, bell.bandMax + 1), false);
    });
});

describe("questBookRyo", () => {
    it("scales with level + weight and stays in an epic-but-sane range", () => {
        assert.ok(questBookRyo(40, 8) > questBookRyo(20, 8), "scales with level");
        assert.ok(questBookRyo(40, 9) > questBookRyo(40, 7), "scales with weight");
        assert.ok(questBookRyo(100, 20) <= 12000, "capped sane");
        assert.equal(questBookRyo(0, 8), questBookRyo(1, 8), "clamps junk level");
    });
});
