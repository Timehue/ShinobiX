import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
    WANDERER_QUESTS,
    isWandererQuestId,
    wandererQuestRyo,
    wandererQuestComplete,
    parseWandererQuestSeal,
} from "./_wanderer-quest.js";

// `relicSurveyCount` is the odd one out: a SET size (distinct biomes walked
// since accept) rather than a lifetime total, which is what lets the relic
// survey ask for "one tile in each country" without lying about its counter.
const VALID_METRICS = new Set(["totalAiKills", "totalPetWins", "cardClashWins", "totalTilesExplored", "relicSurveyCount"]);

describe("WANDERER_QUESTS catalog", () => {
    it("every entry has a known metric + positive target/weight", () => {
        for (const [id, def] of Object.entries(WANDERER_QUESTS)) {
            assert.ok(VALID_METRICS.has(def.metric), `${id} metric`);
            assert.ok(def.target >= 1, `${id} target`);
            assert.ok(def.weight >= 1, `${id} weight`);
        }
        assert.ok(Object.keys(WANDERER_QUESTS).length >= 4, "has variety");
    });
});

describe("isWandererQuestId", () => {
    it("accepts catalog ids and rejects others", () => {
        for (const id of Object.keys(WANDERER_QUESTS)) assert.equal(isWandererQuestId(id), true);
        assert.equal(isWandererQuestId("nope"), false);
        assert.equal(isWandererQuestId("__proto__"), false);
    });
});

describe("wandererQuestRyo", () => {
    it("scales with level and effort weight, stays modest", () => {
        assert.ok(wandererQuestRyo(1, 3) > 0);
        assert.ok(wandererQuestRyo(50, 6) > wandererQuestRyo(20, 3));
        assert.ok(wandererQuestRyo(100, 6) <= 3000);
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
        assert.equal(wandererQuestComplete(10, 9, 3), false);
    });
});

describe("parseWandererQuestSeal", () => {
    it("accepts durable server seals and rejects forged ids", () => {
        assert.deepEqual(parseWandererQuestSeal({ id: "wq-cull", baseline: 12, at: 123 }), { id: "wq-cull", baseline: 12, at: 123 });
        assert.equal(parseWandererQuestSeal({ id: "forged", baseline: 12, at: 123 }), null);
    });
    it("persists durable authority and exposes an authoritative abandon path", () => {
        const endpoint = readFileSync(join(process.cwd(), "api", "sector", "wanderer-quest.ts"), "utf8");
        assert.match(endpoint, /activeWandererQuestSeal: sealed/);
        assert.match(endpoint, /action === 'abandon'/);
        assert.match(endpoint, /activeWandererQuestSeal: null/);
    });
});
