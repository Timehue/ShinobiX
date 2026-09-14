import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
    STORY_RECKONINGS,
    storyReckoningEligible,
    storyReckoningRyo,
    storyReckoningTaskComplete,
    ownedItemCount,
    parseStoryReckoningSeal,
    storyReckoningPresenceReason,
} from "./_story-reckoning.js";

test("story reckoning eligibility follows level, village, progress, and completion trait", () => {
    const def = STORY_RECKONINGS["story-reckoning-mira-marker"];
    assert.ok(def);
    assert.equal(storyReckoningEligible({ level: 25, storyVillage: "Stormveil Village", storyProgress: 3, storyTraits: [] }, def), true);
    assert.equal(storyReckoningEligible({ level: 24, storyVillage: "Stormveil Village", storyProgress: 3, storyTraits: [] }, def), false);
    assert.equal(storyReckoningEligible({ level: 25, storyVillage: "Ashen Leaf Village", storyProgress: 3, storyTraits: [] }, def), false);
    assert.equal(storyReckoningEligible({ level: 25, storyVillage: "Stormveil Village", storyProgress: 2, storyTraits: [] }, def), false);
    assert.equal(storyReckoningEligible({ level: 25, storyVillage: "Stormveil Village", storyProgress: 3, storyTraits: [def.completionTrait] }, def), false);
    assert.equal(storyReckoningEligible({ level: 25, storyVillage: "Stormveil Village", storyProgress: 3, storyTraits: [], redeemedStoryReckonings: [{ questId: def.id }] }, def), false);
});

test("story reckoning task progress is sealed against a baseline", () => {
    assert.equal(storyReckoningTaskComplete(10, 21, 12), false);
    assert.equal(storyReckoningTaskComplete(10, 22, 12), true);
});

test("story reckoning giver presence requires a settled outskirts visit", () => {
    const mira = STORY_RECKONINGS["story-reckoning-mira-marker"];
    const harrow = STORY_RECKONINGS["story-reckoning-harrow-unbought"];
    assert.equal(storyReckoningPresenceReason(mira, null, 100), "presence");
    assert.equal(storyReckoningPresenceReason(mira, { sector: 2 }, 100), "wrong-place");
    assert.equal(storyReckoningPresenceReason(mira, { sector: 1, travelingUntil: 101 }, 100), "traveling");
    assert.equal(storyReckoningPresenceReason(mira, { sector: 1, inBattle: true }, 100), "in-battle");
    assert.equal(storyReckoningPresenceReason(mira, { sector: 1 }, 100), null);
    assert.equal(storyReckoningPresenceReason(harrow, { sector: 26 }, 100), null);
    assert.equal(storyReckoningPresenceReason(harrow, { sector: 27 }, 100), "wrong-place");
});

test("story reckoning rewards and item ownership are stable", () => {
    assert.equal(storyReckoningRyo(58, 6), 1980);
    assert.equal(ownedItemCount({ inventory: ["event-kesa-marker"], itemStacks: [{ itemId: "event-kesa-marker", count: 2 }] }, "event-kesa-marker"), 3);
});

test("story reckoning durable seals validate id, stage, and baseline", () => {
    assert.deepEqual(parseStoryReckoningSeal({ id: "story-reckoning-mira-marker", stage: "task", baseline: 7, at: 9 }), {
        id: "story-reckoning-mira-marker", stage: "task", baseline: 7, at: 9,
    });
    assert.equal(parseStoryReckoningSeal({ id: "story-reckoning-mira-marker", stage: "forged", baseline: 7, at: 9 }), null);
});

test("story reckoning claim authority survives cache expiry and abandon is wired to the client", () => {
    const endpoint = readFileSync(join(process.cwd(), "api", "sector", "story-reckoning.ts"), "utf8");
    const client = readFileSync(join(process.cwd(), "shinobij.client", "src", "screens", "WorldMap.tsx"), "utf8");
    assert.match(endpoint, /parseStoryReckoningSeal\(rec\.activeStoryReckoningSeal\)/);
    assert.match(endpoint, /activeStoryReckoningSeal: nextSeal/);
    assert.match(client, /abandonStoryReckoning\(character\.name\)/);
});

test("client reckoning data and server catalog agree, with real drop items (no drift)", async () => {
    const { storyReckonings } = await import("../../shinobij.client/src/data/story-reckonings.js");
    const { eventItemIds } = await import("../../shinobij.client/src/data/event-items.js");
    // Every client-offered arc has a server def that agrees on gates, task, and reward,
    // and its drop keepsake is a real event item (or turn-in could never succeed).
    for (const arc of storyReckonings) {
        const def = STORY_RECKONINGS[arc.id];
        assert.ok(def, `server catalog is missing ${arc.id}`);
        assert.equal(def.village, arc.village, `${arc.id} village`);
        assert.equal(def.levelReq, arc.levelReq, `${arc.id} levelReq`);
        assert.equal(def.ownProgress, arc.ownProgress, `${arc.id} ownProgress`);
        assert.equal(def.completionTrait, arc.completionTrait, `${arc.id} completionTrait`);
        assert.equal(def.metric, arc.task.metric, `${arc.id} metric`);
        assert.equal(def.target, arc.task.target, `${arc.id} target`);
        assert.equal(def.dropItemId, arc.task.dropItemId, `${arc.id} dropItemId`);
        assert.equal(def.weight, arc.reward.weight, `${arc.id} weight`);
        assert.equal(def.fateShards, arc.reward.fateShards ?? 0, `${arc.id} fateShards`);
        assert.equal(def.title, arc.reward.title, `${arc.id} title`);
        assert.equal(Boolean(def.crossVillage), Boolean(arc.crossVillage), `${arc.id} crossVillage`);
        assert.ok(eventItemIds.has(arc.task.dropItemId), `${arc.id} drop ${arc.task.dropItemId} is not a known event item`);
    }
    // No server def without a matching client arc.
    const clientIds = new Set(storyReckonings.map((a: { id: string }) => a.id));
    for (const id of Object.keys(STORY_RECKONINGS)) {
        assert.ok(clientIds.has(id), `server catalog has an orphan ${id} with no client arc`);
    }
});
