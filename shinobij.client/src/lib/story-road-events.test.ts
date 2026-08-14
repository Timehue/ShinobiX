import { test } from "node:test";
import assert from "node:assert/strict";
import type { Character } from "../types/character";
import { nextRoadEvent, synthRoadWanderer, roadEventToCreatorEvent, roadEventBySynthId, roadEventChoiceTraits, ROAD_WANDERER_PREFIX } from "./story-road-events";
import { storyRoadEvents } from "../data/story-road-events";

function char(level: number, storyProgress: number, storyTraits: string[] = []): Character {
    return { name: "Tester", village: "Stormveil Village", storyVillage: "Stormveil Village", level, storyProgress, storyTraits } as unknown as Character;
}

test("road events arrive lowest-eligible-first and complete by trait presence", () => {
    assert.equal(nextRoadEvent(char(21, 0)), null, "below every gate");
    const first = nextRoadEvent(char(22, 0));
    assert.ok(first);
    assert.equal(first.id, "story-road-border-smoke");
    // Owning ANY of the event's choice traits completes it.
    const done = roadEventChoiceTraits(first)[1];
    const second = nextRoadEvent(char(40, 0, [done]));
    assert.ok(second);
    assert.equal(second.levelReq, 26, "next lowest eligible");
});

test("Seat of Scars requires the Kage finale, everything else is level-gated only", () => {
    const allButLast = storyRoadEvents.slice(0, -1).flatMap((e) => [roadEventChoiceTraits(e)[0]]);
    assert.equal(nextRoadEvent(char(100, 8, allButLast)), null, "level 100 pre-finale: nothing pending");
    const post = nextRoadEvent(char(100, 9, allButLast));
    assert.ok(post);
    assert.equal(post.id, "story-road-seat-of-scars");
});

test("a max character walks the full pool in level order", () => {
    const owned: string[] = [];
    for (let i = 0; i < storyRoadEvents.length; i++) {
        const next = nextRoadEvent(char(100, 9, owned));
        assert.ok(next, `event ${i} missing`);
        assert.equal(next.id, storyRoadEvents[i].id);
        owned.push(roadEventChoiceTraits(next)[0]);
    }
    assert.equal(nextRoadEvent(char(100, 9, owned)), null);
});

test("synthesized wanderer is stable, non-hostile, and resolvable back to its event", () => {
    for (const event of storyRoadEvents) {
        const w = synthRoadWanderer(event, 17);
        assert.equal(w.id, event.id);
        assert.ok(w.id.startsWith(ROAD_WANDERER_PREFIX));
        assert.equal(w.verb, "quest", `${event.id}: road NPCs never auto-attack`);
        assert.deepEqual(synthRoadWanderer(event, 17), w, "deterministic per (event, sector)");
        assert.ok(w.homeTile >= 0 && w.homeTile < 144, `${event.id}: tile in grid`);
        assert.equal(roadEventBySynthId(w.id)?.id, event.id);
    }
});

test("CreatorEvent conversion: zero rewards, battles only where authored", () => {
    let battles = 0;
    for (const event of storyRoadEvents) {
        const vn = roadEventToCreatorEvent(event, "forest");
        assert.equal(vn.xpReward, 0);
        assert.equal(vn.ryoReward, 0);
        assert.equal(vn.eventKind, "visualNovel");
        const lastPage = vn.vnPages![vn.vnPages!.length - 1];
        for (const choice of lastPage.choices ?? []) {
            assert.ok(choice.trait, `${event.id}: choice without trait`);
            if (choice.battle) {
                battles++;
                assert.equal(choice.battle.encounterType, "ai");
                assert.ok(!choice.battle.xpReward, `${event.id}: road battles pay no XP`);
            }
        }
    }
    assert.ok(battles > 0, "at least some road events end in a fight");
});

test("the shared-shrine road story uses shinobi-world civilian language", () => {
    const shrine = storyRoadEvents.find((event) => event.slug === "shrine-of-two-flags");
    assert.ok(shrine);
    const playerFacingCopy = [
        shrine.title,
        ...shrine.pages.flatMap((page) => [page.title, page.scene, ...page.dialogue, ...(page.choices ?? []).map((choice) => `${choice.text} ${choice.conclusion}`)]),
    ].join(" ");
    assert.doesNotMatch(playerFacingCopy, /\bpilgrims?\b/i);
    assert.match(playerFacingCopy, /passing shinobi/);
    assert.match(playerFacingCopy, /civilians/);
});
