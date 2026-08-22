import { test } from "node:test";
import assert from "node:assert/strict";
import type { Character } from "../types/character";
import { storylines } from "../data/storylines";
import { storyInterludesByVillage } from "../data/story-interludes";
import { buildCompletedStoryArchive, storyArchiveGuidance } from "../lib/story-archive";
import { STORY_CONTENT_SCHEMA_VERSION, type StoryContentPayload } from "../lib/story-content-contract";
import { readFileSync } from "node:fs";

const storyHallSource = readFileSync(new URL("../screens/StoryBoss.tsx", import.meta.url), "utf8");
const livingChronicleSource = readFileSync(new URL("./LivingChronicle.tsx", import.meta.url), "utf8");
const storyJourneySource = readFileSync(new URL("./StoryJourney.tsx", import.meta.url), "utf8");

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
    assert.ok(archived.decisions.some((decision) => decision.text));
});

test("completed chapter replay follows the recorded branch and lists its decisions", () => {
    const chapter = storylines["Stormveil Village"][0];
    const picked = chapter.pages?.flatMap((page) => page.choices ?? []).find((choice) => choice.trait);
    assert.ok(picked?.trait);
    const archived = buildCompletedStoryArchive(character(1, [picked.trait]), content)[0];
    assert.ok(archived);
    assert.ok(archived.decisions.some((decision) => decision.text === picked.text));
    assert.ok(archived.pages.length < (chapter.pages?.length ?? 0), "replay should omit authored branches the player did not take");
    assert.equal(archived.replayEvent.ryoReward, 0);
    assert.equal(archived.replayEvent.xpReward, 0);
    assert.ok(archived.replayEvent.vnPages?.every((page) => !page.choices));
});

test("completed stories offer a mutation-free cinematic replay", () => {
    assert.match(storyJourneySource, /Watch cinematic replay/);
    assert.match(storyJourneySource, /readOnlyReplay/);
    assert.match(storyJourneySource, /onBattle=\{closeCinematicReplay\}/);
    const replayReader = readFileSync(new URL("./TriggeredVisualNovel.tsx", import.meta.url), "utf8");
    assert.match(replayReader, /readOnlyReplay\s*\?\s*"Story Replay"/);
    assert.match(replayReader, /if \(readOnlyReplay \|\| !choicesArmed/);
    assert.match(replayReader, /if \(!readOnlyReplay && beginAction\(\)\) onBattle/);
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

test("Story Hall separates completed stories from the Living Chronicle", () => {
    assert.match(storyHallSource, /aria-label="Story Hall sections"/);
    assert.match(storyHallSource, />\s*Completed Stories\s*</);
    assert.match(storyHallSource, />\s*Living Chronicle\s*</);
    assert.match(storyHallSource, /aria-pressed=\{section === "stories"\}/);
    assert.match(storyHallSource, /aria-pressed=\{section === "chronicle"\}/);
});

test("Living Chronicle owns the moved progression spine and shared-world records", () => {
    assert.match(livingChronicleSource, /ONE JOURNEY · FOUR FORMS OF PROOF/);
    assert.match(livingChronicleSource, /YOUR DEEDS/);
    assert.match(livingChronicleSource, /VILLAGE RECORD/);
    assert.match(livingChronicleSource, /CLAN RECORD/);
    assert.match(livingChronicleSource, /endedVillageWarRecordsFor\(village, 3\)/);
    assert.match(livingChronicleSource, /cwListWars\(\)/);
});
