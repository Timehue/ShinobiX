import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
    WANDERER_QUEST_TARGETS,
    isWandererQuestId,
    wandererQuestRyo,
    wandererQuestComplete,
} from "./_wanderer-quest.js";

describe("isWandererQuestId", () => {
    it("accepts catalog ids and rejects others", () => {
        for (const id of Object.keys(WANDERER_QUEST_TARGETS)) assert.equal(isWandererQuestId(id), true);
        assert.equal(isWandererQuestId("nope"), false);
        assert.equal(isWandererQuestId("__proto__"), false);
    });
});

describe("wandererQuestRyo", () => {
    it("scales with level and target, stays modest", () => {
        assert.ok(wandererQuestRyo(1, 3) > 0);
        assert.ok(wandererQuestRyo(50, 6) > wandererQuestRyo(20, 3));
        assert.ok(wandererQuestRyo(100, 6) <= 3000, "stays modest");
    });
    it("clamps junk input", () => {
        assert.equal(wandererQuestRyo(0, 3), wandererQuestRyo(1, 3));
        assert.equal(wandererQuestRyo(9999, 3), wandererQuestRyo(100, 3));
    });
});

describe("wandererQuestComplete", () => {
    it("is met only when current − baseline reaches target", () => {
        assert.equal(wandererQuestComplete(10, 12, 3), false);
        assert.equal(wandererQuestComplete(10, 13, 3), true);
        assert.equal(wandererQuestComplete(10, 99, 3), true);
        assert.equal(wandererQuestComplete(10, 9, 3), false); // counter can't go backwards into completion
    });
});
