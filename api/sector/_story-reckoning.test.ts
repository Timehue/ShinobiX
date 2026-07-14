import test from "node:test";
import assert from "node:assert/strict";
import {
    STORY_RECKONINGS,
    storyReckoningEligible,
    storyReckoningRyo,
    storyReckoningTaskComplete,
    ownedItemCount,
} from "./_story-reckoning.js";

test("story reckoning eligibility follows level, village, progress, and completion trait", () => {
    const def = STORY_RECKONINGS["story-reckoning-mira-marker"];
    assert.ok(def);
    assert.equal(storyReckoningEligible({ level: 25, storyVillage: "Stormveil Village", storyProgress: 3, storyTraits: [] }, def), true);
    assert.equal(storyReckoningEligible({ level: 24, storyVillage: "Stormveil Village", storyProgress: 3, storyTraits: [] }, def), false);
    assert.equal(storyReckoningEligible({ level: 25, storyVillage: "Ashen Leaf Village", storyProgress: 3, storyTraits: [] }, def), false);
    assert.equal(storyReckoningEligible({ level: 25, storyVillage: "Stormveil Village", storyProgress: 2, storyTraits: [] }, def), false);
    assert.equal(storyReckoningEligible({ level: 25, storyVillage: "Stormveil Village", storyProgress: 3, storyTraits: [def.completionTrait] }, def), false);
});

test("story reckoning task progress is sealed against a baseline", () => {
    assert.equal(storyReckoningTaskComplete(10, 21, 12), false);
    assert.equal(storyReckoningTaskComplete(10, 22, 12), true);
});

test("story reckoning rewards and item ownership are stable", () => {
    assert.equal(storyReckoningRyo(58, 6), 1980);
    assert.equal(ownedItemCount({ inventory: ["event-kesa-marker"], itemStacks: [{ itemId: "event-kesa-marker", count: 2 }] }, "event-kesa-marker"), 3);
});
