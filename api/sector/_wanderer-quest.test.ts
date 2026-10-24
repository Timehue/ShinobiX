import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
    WANDERER_QUESTS,
    EMISSARY_ERRAND_GIVER,
    EMISSARY_MIN_LEVEL,
    EMISSARY_WANDERER_PREFIX,
    isWandererQuestId,
    validateWandererQuestPick,
    wandererQuestRyo,
    wandererQuestComplete,
    parseWandererQuestSeal,
} from "./_wanderer-quest.js";
import { WANDERER_QUEST_OFFER_POOL, lockedQuestMetrics, questIdForWanderer } from "../../shared/wanderer-quest-offer.js";

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

describe("the server picks the errand (I-13)", () => {
    const sage = (i: number) => `w-${(i % 60) + 1}-5000-${i % 2}`;
    const open: Record<string, unknown> = { level: 60, starterCardsClaimed: true, pets: [{}] };
    const sealed: Record<string, unknown> = { level: 60 };

    it("the offer pool is exactly the road-sage half of the catalog, metric for metric", () => {
        const wq = Object.entries(WANDERER_QUESTS).filter(([id]) => id.startsWith("wq-")).map(([id, def]) => ({ id, metric: def.metric }));
        assert.deepEqual(WANDERER_QUEST_OFFER_POOL.map(({ id, metric }) => ({ id, metric })).sort((a, b) => a.id.localeCompare(b.id)),
            wq.sort((a, b) => a.id.localeCompare(b.id)));
    });

    it("every emissary errand has exactly one giver, and every giver entry is a real errand", () => {
        const eq = Object.keys(WANDERER_QUESTS).filter((id) => id.startsWith("eq-")).sort();
        assert.deepEqual(Object.keys(EMISSARY_ERRAND_GIVER).sort(), eq);
        assert.equal(EMISSARY_WANDERER_PREFIX, "legacy-emissary-");
        assert.equal(EMISSARY_MIN_LEVEL, 40);
    });

    it("a road sage offers only the errand its id hashes to", () => {
        for (let i = 0; i < 200; i++) {
            const id = sage(i);
            const offered = questIdForWanderer(id, lockedQuestMetrics(open));
            assert.deepEqual(validateWandererQuestPick(offered, id, true, open), { ok: true }, `${id} ${offered}`);
            for (const other of WANDERER_QUEST_OFFER_POOL.filter((q) => q.id !== offered)) {
                assert.equal(validateWandererQuestPick(other.id, id, true, open).ok, false, `${id} must refuse ${other.id}`);
            }
        }
    });

    it("draws a sealed player's errand from what they can progress", () => {
        const locked = lockedQuestMetrics(sealed);
        assert.deepEqual(locked, ["cardClashWins", "totalPetWins"]);
        for (let i = 0; i < 200; i++) {
            const id = sage(i);
            const offered = questIdForWanderer(id, locked);
            assert.ok(!["wq-cards", "wq-highroller", "wq-beasts", "wq-menagerie"].includes(offered), offered);
            assert.equal(validateWandererQuestPick(offered, id, true, sealed).ok, true);
        }
    });

    it("refuses a road-sage errand from anything but a road sage", () => {
        for (const wandererId of ["", "legacy-sage", "legacy-emissary-hollow-warden"]) {
            assert.deepEqual(validateWandererQuestPick("wq-cull", wandererId, false, open), { ok: false, reason: "invalid-quest" }, wandererId || "(no id)");
        }
        assert.equal(validateWandererQuestPick("nope", sage(1), true, open).ok, false);
    });

    it("an emissary offers only its own two errands, from level 40, minus locked objectives", () => {
        const warden = `${EMISSARY_WANDERER_PREFIX}hollow-warden`;
        assert.equal(validateWandererQuestPick("eq-hollow-toll", warden, false, { level: 40 }).ok, true);
        assert.equal(validateWandererQuestPick("eq-hollow-depths", warden, false, { level: 40 }).ok, true);
        assert.equal(validateWandererQuestPick("eq-hollow-toll", warden, false, { level: 39 }).ok, false, "below the emissary level");
        assert.equal(validateWandererQuestPick("eq-hollow-toll", `${EMISSARY_WANDERER_PREFIX}mapless-ojii`, false, { level: 60 }).ok, false, "another emissary's errand");
        assert.equal(validateWandererQuestPick("eq-hollow-toll", "", false, { level: 60 }).ok, false, "no emissary id");
        assert.equal(validateWandererQuestPick("eq-hollow-toll", sage(3), true, { level: 60 }).ok, false, "a road sage carries no emissary errand");
        const ojii = `${EMISSARY_WANDERER_PREFIX}mapless-ojii`;
        assert.equal(validateWandererQuestPick("eq-mapless-companions", ojii, false, { level: 60 }).ok, false, "a pet errand for a player with no pet");
        assert.equal(validateWandererQuestPick("eq-mapless-companions", ojii, false, { level: 60, pets: [{}] }).ok, true);
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
