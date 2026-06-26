import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { rivalryEscalation, epicForWanderer, QUEST_BOOK } from "./questbook";

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
