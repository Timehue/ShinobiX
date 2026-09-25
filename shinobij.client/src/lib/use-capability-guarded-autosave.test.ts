import assert from "node:assert/strict";
import { test } from "node:test";
import { regenerateIdleVitals } from "./loaded-vitals";
import { isIdleRegenTickOnly, type DebounceTriggers } from "./use-capability-guarded-autosave";

// A character just after a story boss win: the server settles HP to what
// survived the fight, so every vital regenerates for minutes afterwards.
const settled = {
    name: "AuditNinja",
    hp: 9_084, maxHp: 10_800,
    chakra: 9_084, maxChakra: 10_800,
    stamina: 9_084, maxStamina: 10_800,
    storyEpilogues: [{ version: 1, chapterEventId: "story-ashen-leaf-village-100-8", lane: "honorable", status: "pending", presentationTraits: [] }],
};
const seen = { ...settled, storyEpilogues: [{ ...settled.storyEpilogues[0], status: "seen" }] };
const triggers = (character: unknown, overrides: Partial<DebounceTriggers> = {}): DebounceTriggers => ({
    character, accountName: "AuditNinja", sector: 40, pendingTravel: null, missionBattleActive: false, ...overrides,
});

test("an idle-regeneration tick keeps the pending autosave countdown", () => {
    const ticked = regenerateIdleVitals(seen, 1);
    assert.notEqual(ticked, seen, "the fixture must really tick");
    assert.equal(isIdleRegenTickOnly(triggers(seen), triggers(ticked)), true);
    // Consecutive ticks, one per second, never restart it either.
    assert.equal(isIdleRegenTickOnly(triggers(ticked), triggers(regenerateIdleVitals(ticked, 1))), true);
});

test("a real change restarts the countdown, even alongside a regen tick", () => {
    assert.equal(isIdleRegenTickOnly(triggers(settled), triggers(seen)), false, "marking the epilogue seen is a local change");
    assert.equal(isIdleRegenTickOnly(triggers(settled), triggers(regenerateIdleVitals(seen, 1))), false,
        "a tick batched into the same commit must not hide the change");
    assert.equal(isIdleRegenTickOnly(triggers(settled), triggers({ ...settled, hp: settled.hp + 500 })), false,
        "a heal on one vital is a grant, not regeneration");
});

test("every other debounce trigger still restarts the countdown", () => {
    const ticked = regenerateIdleVitals(seen, 1);
    assert.equal(isIdleRegenTickOnly(null, triggers(ticked)), false, "the first run arms a fresh countdown");
    assert.equal(isIdleRegenTickOnly(triggers(seen), triggers(seen, { sector: 41 })), false);
    assert.equal(isIdleRegenTickOnly(triggers(seen), triggers(ticked, { sector: 41 })), false);
    assert.equal(isIdleRegenTickOnly(triggers(seen), triggers(ticked, { pendingTravel: { arrivalAt: 1 } })), false);
    assert.equal(isIdleRegenTickOnly(triggers(seen), triggers(ticked, { missionBattleActive: true })), false);
    assert.equal(isIdleRegenTickOnly(triggers(seen), triggers(ticked, { accountName: "OtherNinja" })), false);
    assert.equal(isIdleRegenTickOnly(triggers(seen), triggers(seen)), false, "an unchanged character is not a tick");
});
