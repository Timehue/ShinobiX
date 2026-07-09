import { test } from "node:test";
import assert from "node:assert/strict";
import type { Character } from "../types/character";
import { nextStoryTrigger, interludeToCreatorEvent } from "./story-trigger";
import { storyInterludesByVillage } from "../data/story-interludes";

// Minimal character stub — nextStoryTrigger only reads these fields.
function char(level: number, storyProgress: number, village = "Stormveil Village"): Character {
    return {
        name: "Tester",
        village,
        storyVillage: village,
        level,
        storyProgress,
        storyTraits: [],
    } as unknown as Character;
}

test("fresh character gets the level-4 milestone, not an interlude", () => {
    const next = nextStoryTrigger(char(4, 0), []);
    assert.ok(next);
    assert.equal(next.returnScreen, "storyHall");
    assert.equal(next.eventId, "story-stormveil-village-4-0");
});

test("interlude gates on minProgress: level 20 with only one chapter beaten stays silent", () => {
    // storyProgress 1 = only the level-4 chapter beaten; the level-15 milestone
    // is the pending beat, and at level 20 it should fire (levelReq 15 <= 20).
    const next = nextStoryTrigger(char(20, 1), []);
    assert.ok(next);
    assert.equal(next.eventId, "story-stormveil-village-15-1");
    // With the 15-chapter also already triggered (VN seen, boss unbeaten),
    // nothing fires — the interlude still needs storyProgress >= 2.
    assert.equal(nextStoryTrigger(char(20, 1), ["story-stormveil-village-15-1"]), null);
});

test("level-20 interlude fires once both gates pass, and only once", () => {
    const first = nextStoryTrigger(char(20, 2), []);
    assert.ok(first);
    assert.equal(first.eventId, "story-interlude-stormveil-village-20");
    assert.equal(first.returnScreen, "current");
    assert.equal(first.base.xpReward, 0);
    assert.equal(first.base.ryoReward, 0);
    const after = nextStoryTrigger(char(20, 2), [first.eventId]);
    assert.equal(after, null);
});

test("lower level fires first when a milestone and an interlude are both pending", () => {
    // Level 30, two chapters beaten: the 25-milestone (levelReq 25) and the
    // 20-interlude (minProgress 2) are both eligible — the interlude is lower.
    const next = nextStoryTrigger(char(30, 2), []);
    assert.ok(next);
    assert.equal(next.eventId, "story-interlude-stormveil-village-20");
    // Once it has fired, the milestone is next.
    const then = nextStoryTrigger(char(30, 2), ["story-interlude-stormveil-village-20"]);
    assert.ok(then);
    assert.equal(then.eventId, "story-stormveil-village-25-2");
});

test("interludes fire in level order within a village", () => {
    const fired: string[] = [];
    // Max-progress, max-level character: every interlude is eligible; they
    // should arrive strictly in catalog (level) order.
    for (let i = 0; i < 7; i++) {
        const next = nextStoryTrigger(char(100, 9, "Moonshadow Village"), fired);
        assert.ok(next, `interlude ${i} missing`);
        fired.push(next.eventId);
    }
    assert.deepEqual(fired, storyInterludesByVillage["Moonshadow Village"].map((e) => e.id));
    assert.equal(nextStoryTrigger(char(100, 9, "Moonshadow Village"), fired), null);
});

test("interludeToCreatorEvent builds a VN-only event: no battle on any choice", () => {
    for (const village of Object.keys(storyInterludesByVillage)) {
        for (const entry of storyInterludesByVillage[village]) {
            const event = interludeToCreatorEvent(entry);
            assert.equal(event.id, entry.id);
            assert.equal(event.eventKind, "visualNovel");
            assert.equal(event.xpReward, 0);
            assert.equal(event.ryoReward, 0);
            for (const page of event.vnPages ?? []) {
                for (const choice of page.choices ?? []) {
                    assert.equal(choice.battle, undefined, `${entry.id} has a battle choice`);
                }
            }
        }
    }
});
