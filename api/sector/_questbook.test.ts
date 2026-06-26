import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
    QUEST_BOOK,
    isQuestBookId,
    questBookEntry,
    questStage,
    finalStageIndex,
    questStageComplete,
    bandMatches,
    questBookRyo,
} from "./_questbook.js";

const VALID_METRICS = new Set(["totalAiKills", "totalPetWins", "cardClashWins", "totalTilesExplored"]);

describe("QUEST_BOOK catalog", () => {
    it("every epic is well-formed: ordered stages, known metrics, positive counts", () => {
        assert.ok(Object.keys(QUEST_BOOK).length >= 3, "has variety");
        for (const [id, q] of Object.entries(QUEST_BOOK)) {
            assert.equal(q.id, id, `${id} id mirrors key`);
            assert.ok(q.stages.length >= 2, `${id} is multi-stage`);
            assert.ok(q.bandMin >= 1 && q.bandMax <= 100 && q.bandMin <= q.bandMax, `${id} band`);
            assert.ok(q.weight >= 1 && q.fateShards >= 0 && q.award, `${id} reward fields`);
            const keys = new Set<string>();
            for (const s of q.stages) {
                assert.ok(VALID_METRICS.has(s.metric), `${id}/${s.key} metric`);
                assert.ok(s.count >= 1, `${id}/${s.key} count`);
                assert.ok(s.text.length > 0, `${id}/${s.key} text`);
                assert.ok(!keys.has(s.key), `${id} duplicate stage key ${s.key}`);
                keys.add(s.key);
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
