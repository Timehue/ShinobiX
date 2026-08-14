import { test } from "node:test";
import assert from "node:assert/strict";
import type { Character } from "../types/character";
import { storylines } from "../data/storylines";
import { storyInterludesByVillage } from "../data/story-interludes";
import { buildCompletedStoryArchive, storyArchiveGuidance } from "../lib/story-archive";
import { STORY_CONTENT_SCHEMA_VERSION, type StoryContentPayload } from "../lib/story-content-contract";

const content: StoryContentPayload = {
    schemaVersion: STORY_CONTENT_SCHEMA_VERSION,
    village: "Stormveil Village",
    chapters: storylines["Stormveil Village"],
    interludes: storyInterludesByVillage["Stormveil Village"],
};

function character(storyProgress: number, storyTraits: string[] = []): Character {
    return {
        name: "Archive Tester",
        village: "Stormveil Village",
        storyVillage: "Stormveil Village",
        storyProgress,
        storyTraits,
    } as unknown as Character;
}

test("Story Hall archive includes completed chapters only", () => {
    const archive = buildCompletedStoryArchive(character(2), content);
    const chapters = archive.filter((entry) => entry.kind === "chapter");
    assert.equal(chapters.length, 2);
    assert.deepEqual(chapters.map((entry) => entry.title), storylines["Stormveil Village"].slice(0, 2).map((step) => step.title));
    assert.ok(!archive.some((entry) => entry.title === storylines["Stormveil Village"][2].title));
});

test("Story Hall archive includes only interludes with a recorded choice", () => {
    const interlude = storyInterludesByVillage["Stormveil Village"][0];
    const trait = interlude.pages.at(-1)?.choices?.find((choice) => choice.trait)?.trait;
    assert.ok(trait);
    const before = buildCompletedStoryArchive(character(2), content);
    assert.ok(!before.some((entry) => entry.id === interlude.id));
    const after = buildCompletedStoryArchive(character(2, [trait]), content);
    const archived = after.find((entry) => entry.id === interlude.id);
    assert.ok(archived);
    assert.equal(archived.kind, "interlude");
    assert.ok(archived.chosen?.text);
});

test("empty archive reveals no future story metadata", () => {
    assert.deepEqual(buildCompletedStoryArchive(character(0), content), []);
});

test("Story Hall guidance reveals only the next level gate", () => {
    const guidance = storyArchiveGuidance({ ...character(1), level: 10 }, content);
    assert.equal(guidance.state, "level-gated");
    assert.equal(guidance.title, "Reach level 15");
    assert.ok(!guidance.body.includes(storylines["Stormveil Village"][1].title));
    assert.ok(!guidance.body.includes(storylines["Stormveil Village"][1].bossName));
});

test("Story Hall guidance explains ready, recovery, and completed states", () => {
    const ready = storyArchiveGuidance({ ...character(1), level: 15 }, content);
    assert.equal(ready.state, "ready");
    assert.equal(ready.actionLabel, "Return to Village");

    const complete = storyArchiveGuidance({ ...character(storylines["Stormveil Village"].length), level: 100 }, content);
    assert.equal(complete.state, "complete");
    assert.equal(complete.actionLabel, undefined);
});
