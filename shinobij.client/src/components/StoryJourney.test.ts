import { test } from "node:test";
import assert from "node:assert/strict";
import type { Character } from "../types/character";
import { storylines } from "../data/storylines";
import { storyInterludesByVillage } from "../data/story-interludes";
import { buildCompletedStoryArchive } from "../lib/story-archive";

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
    const archive = buildCompletedStoryArchive(character(2));
    const chapters = archive.filter((entry) => entry.kind === "chapter");
    assert.equal(chapters.length, 2);
    assert.deepEqual(chapters.map((entry) => entry.title), storylines["Stormveil Village"].slice(0, 2).map((step) => step.title));
    assert.ok(!archive.some((entry) => entry.title === storylines["Stormveil Village"][2].title));
});

test("Story Hall archive includes only interludes with a recorded choice", () => {
    const interlude = storyInterludesByVillage["Stormveil Village"][0];
    const trait = interlude.pages.at(-1)?.choices?.find((choice) => choice.trait)?.trait;
    assert.ok(trait);
    const before = buildCompletedStoryArchive(character(2));
    assert.ok(!before.some((entry) => entry.id === interlude.id));
    const after = buildCompletedStoryArchive(character(2, [trait]));
    const archived = after.find((entry) => entry.id === interlude.id);
    assert.ok(archived);
    assert.equal(archived.kind, "interlude");
    assert.ok(archived.chosen?.text);
});

test("empty archive reveals no future story metadata", () => {
    assert.deepEqual(buildCompletedStoryArchive(character(0)), []);
});
