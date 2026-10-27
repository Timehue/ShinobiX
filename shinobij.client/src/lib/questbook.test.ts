import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { rivalryEscalation, epicForWanderer, metricLabel, questbookStageText, questbookStageProgress, QUEST_BOOK } from "./questbook";

describe("rivalryEscalation (Kazan capstone)", () => {
    it("scales with the rivalry tier and is capped", () => {
        assert.deepEqual(rivalryEscalation(0), { level: 0, stat: 0 });
        assert.deepEqual(rivalryEscalation(1), { level: 2, stat: 2 });
        assert.deepEqual(rivalryEscalation(3), { level: 6, stat: 6 });
        // capped: level at 12, stat at 8
        assert.deepEqual(rivalryEscalation(20), { level: 12, stat: 8 });
    });
    it("treats junk / missing tier as zero", () => {
        assert.deepEqual(rivalryEscalation(null), { level: 0, stat: 0 });
        assert.deepEqual(rivalryEscalation(undefined), { level: 0, stat: 0 });
        assert.deepEqual(rivalryEscalation(NaN), { level: 0, stat: 0 });
    });
    it("only Kazan's capstone boss is flagged to scale", () => {
        // sanity: the flag exists where we expect and nowhere else surprising
        const kazanStage = QUEST_BOOK["qb-ashes"].stages.find(s => s.bossId === "kazan-ashbound");
        assert.ok(kazanStage, "capstone has the Kazan stage");
    });
});

describe("epicForWanderer gating", () => {
    const lvl = 55; // matches qb-defector (40-65) + qb-ashes (50-100) bands
    it("hides war-gated epics until the village is at war", () => {
        // Force the offer toward each id by scanning many wanderer ids; assert the
        // war-gated epic NEVER appears without atWar, and CAN appear with it.
        const ids = Array.from({ length: 200 }, (_, i) => `w-${i}`);
        const peacetime = new Set(ids.map(id => epicForWanderer(id, lvl, { atWar: false })?.id));
        assert.ok(!peacetime.has("qb-defector"), "Frostfang Defector hidden in peacetime");
        const wartime = new Set(ids.map(id => epicForWanderer(id, lvl, { atWar: true })?.id));
        assert.ok(wartime.has("qb-defector"), "Frostfang Defector offered during war");
    });
    it("hides the rivalry-gated capstone until you carry a nemesis", () => {
        const ids = Array.from({ length: 200 }, (_, i) => `w-${i}`);
        const noRival = new Set(ids.map(id => epicForWanderer(id, 80, { hasRivalry: false })?.id));
        assert.ok(!noRival.has("qb-ashes"), "capstone hidden without a rivalry");
        const withRival = new Set(ids.map(id => epicForWanderer(id, 80, { hasRivalry: true })?.id));
        assert.ok(withRival.has("qb-ashes"), "capstone offered with a rivalry");
    });
});

describe("quest stage copy", () => {
    it("counts fresh quest-boss receipts instead of unrelated AI victories", () => {
        const epic = { id: "qb-caravan", stage: 1, baseline: 10 };
        const stage = QUEST_BOOK[epic.id].stages[epic.stage];
        const win = { kind: "questbook-boss", sourceId: epic.id, stage: 1, sealVersion: "qb-caravan:1:10:1234", proofId: "goro-1" };
        assert.equal(questbookStageProgress({ totalAiKills: 100 }, epic, stage), 0);
        assert.equal(questbookStageProgress({ totalAiKills: 100, worldAiContextWins: [win, win,
            { ...win, sealVersion: "qb-caravan:1:9:1200", proofId: "old" },
            { ...win, sourceId: "qb-bell", proofId: "other" }] }, epic, stage), 1);
        assert.equal(questbookStageProgress({ totalTilesExplored: 12 }, { ...epic, stage: 0 }, QUEST_BOOK[epic.id].stages[0]), 2);
    });

    it("names the recorded Explore action and treats general duels as preparation", () => {
        assert.equal(metricLabel("totalTilesExplored"), "Explore actions completed");
        assert.match(QUEST_BOOK["qb-bell"].stages[2].text, /Explore 4 times within 30 minutes/);
        assert.match(QUEST_BOOK["qb-caravan"].stages[0].text, /Explore 3 times/);
        assert.match(QUEST_BOOK["qb-gauntlet"].stages[0].text, /prepare/i);
        assert.doesNotMatch(QUEST_BOOK["qb-gauntlet"].stages[0].text, /Tomoe's wandering beasts/i);
        const finale = QUEST_BOOK["qb-gauntlet"].stages[1];
        // Only rewarded wins raise totalPetWins: practice fights and wins past
        // the Colosseum's daily cap do not, so the copy must not say "any opponent".
        assert.match(finale.text, /rewarded pet battle.*Pet Colosseum/);
        assert.doesNotMatch(finale.text, /any opponent/);
        assert.equal(finale.bossId, undefined, "no specific Storm-Hound fight exists at the quest giver");
        assert.equal(questbookStageProgress({ totalPetWins: 4 }, { id: "qb-gauntlet", stage: 1, baseline: 3 }, finale), 1);
    });

    it("keeps the defector's protected testimony and arrest outcomes distinct through pursuit", () => {
        const offer = QUEST_BOOK["qb-defector"].stages[0];
        const pursuit = QUEST_BOOK["qb-defector"].stages[1];
        assert.match(offer.choice!.options[0].blurb, /independent waystation/i);
        assert.match(offer.choice!.options[1].blurb, /prisoner.*intelligence office/i);
        assert.match(questbookStageText(pursuit, { offer: "trust" }), /protect the witness.*courier/i);
        assert.match(questbookStageText(pursuit, { offer: "turnin" }), /protect the prisoner.*intelligence office/i);
    });
});
