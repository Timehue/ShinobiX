import { test } from "node:test";
import assert from "node:assert/strict";
import type { Character } from "../types/character";
import { storylines } from "../data/storylines";
import { storyInterludesByVillage } from "../data/story-interludes";
import { buildCompletedStoryArchive, storyArchiveGuidance } from "../lib/story-archive";
import { STORY_CONTENT_SCHEMA_VERSION, type StoryContentPayload } from "../lib/story-content-contract";
import { makeStoryChoiceReceipt } from "../lib/story-choice-history";
import { currentStoryChapterTriggerFromContent, interludeToCreatorEvent, nextStoryTriggerFromContent, storyToCreatorEvent } from "../lib/story-trigger";
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
    const event = interludeToCreatorEvent(interlude);
    const pageIndex = interlude.pages.length - 1;
    const choiceIndex = interlude.pages[pageIndex].choices!.findIndex((choice) => choice.trait === trait);
    const afterCharacter = character(2, [trait]);
    afterCharacter.storyChoices = [makeStoryChoiceReceipt(event, pageIndex, choiceIndex, event.vnPages![pageIndex].choices![choiceIndex])];
    const after = buildCompletedStoryArchive(afterCharacter, content);
    const archived = after.find((entry) => entry.id === interlude.id);
    assert.ok(archived);
    assert.equal(archived.kind, "interlude");
    assert.ok(archived.decisions.some((decision) => decision.text));
});

test("completed chapter replay follows the recorded branch and lists its decisions", () => {
    const chapter = storylines["Stormveil Village"][0];
    const pageIndex = chapter.pages?.findIndex((page) => page.choices?.some((choice) => choice.trait)) ?? -1;
    const choiceIndex = chapter.pages?.[pageIndex]?.choices?.findIndex((choice) => choice.trait) ?? -1;
    const picked = chapter.pages?.[pageIndex]?.choices?.[choiceIndex];
    assert.ok(picked?.trait);
    const event = storyToCreatorEvent(chapter, "Stormveil Village", 0);
    const recorded = character(1, [picked.trait]);
    recorded.storyChoices = [makeStoryChoiceReceipt(event, pageIndex, choiceIndex, event.vnPages![pageIndex].choices![choiceIndex])];
    const archived = buildCompletedStoryArchive(recorded, content)[0];
    assert.ok(archived);
    assert.ok(archived.decisions.some((decision) => decision.text === picked.text));
    assert.ok(archived.pages.length < (chapter.pages?.length ?? 0), "replay should omit authored branches the player did not take");
    assert.equal(archived.replayEvent.ryoReward, 0);
    assert.equal(archived.replayEvent.xpReward, 0);
    assert.ok(archived.replayEvent.vnPages?.every((page) => !page.choices));
});

test("Ashen Leaf level 15 archives each Night Watch route from its exact receipt", () => {
    const ashenContent: StoryContentPayload = {
        schemaVersion: STORY_CONTENT_SCHEMA_VERSION,
        village: "Ashen Leaf Village",
        chapters: storylines["Ashen Leaf Village"],
        interludes: storyInterludesByVillage["Ashen Leaf Village"],
    };
    const chapter = ashenContent.chapters[1];
    const event = storyToCreatorEvent(chapter, ashenContent.village, 1);
    for (const [choiceIndex, included, excluded] of [[0, "Imera's Shears", "The Longest Cut"], [1, "The Longest Cut", "Imera's Shears"]] as const) {
        const played = { ...character(2, ["reckless"]), village: ashenContent.village, storyVillage: ashenContent.village };
        played.storyChoices = [
            makeStoryChoiceReceipt(event, 5, choiceIndex, event.vnPages![5].choices![choiceIndex]),
            makeStoryChoiceReceipt(event, 9, 1, event.vnPages![9].choices![1]),
        ];
        const archived = buildCompletedStoryArchive(played, ashenContent).find((entry) => entry.level === 15)!;
        assert.ok(archived.pages.some((page) => page.title === included));
        assert.ok(!archived.pages.some((page) => page.title === excluded));
        assert.ok(archived.decisions.some((decision) => decision.text === event.vnPages![5].choices![choiceIndex].text));
    }
});

test("Ashen Leaf level 65 preserves the selected opening branch", () => {
    const ashenContent: StoryContentPayload = {
        schemaVersion: STORY_CONTENT_SCHEMA_VERSION,
        village: "Ashen Leaf Village",
        chapters: storylines["Ashen Leaf Village"],
        interludes: storyInterludesByVillage["Ashen Leaf Village"],
    };
    const event = storyToCreatorEvent(ashenContent.chapters[5], ashenContent.village, 5);
    for (const [choiceIndex, included, excluded] of [[1, "A Fair Question", "The Charts"], [2, "The Charts", "A Fair Question"]] as const) {
        const played = { ...character(6), village: ashenContent.village, storyVillage: ashenContent.village };
        played.storyChoices = [
            makeStoryChoiceReceipt(event, 0, choiceIndex, event.vnPages![0].choices![choiceIndex]),
            makeStoryChoiceReceipt(event, 3, 0, event.vnPages![3].choices![0]),
            makeStoryChoiceReceipt(event, 5, 0, event.vnPages![5].choices![0]),
            makeStoryChoiceReceipt(event, 6, 0, event.vnPages![6].choices![0]),
            makeStoryChoiceReceipt(event, 8, 0, event.vnPages![8].choices![0]),
        ];
        const archived = buildCompletedStoryArchive(played, ashenContent).find((entry) => entry.level === 65)!;
        assert.ok(archived.pages.some((page) => page.title === included));
        assert.ok(!archived.pages.some((page) => page.title === excluded));
    }
});

test("archive preserves repeated finale hub visits and every accepted callback", () => {
    const chapter = {
        levelReq: 100, title: "Final Hub", bossName: "Kage", bossIcon: "K", rewardXp: 0, rewardRyo: 0,
        pages: [
            { title: "Hub", scene: "", speaker: "Kage", dialogue: ["Choose"], choices: [
                { text: "Present proof", conclusion: "The proof enters the record.", nextPage: 1, trait: "test-proof" },
                { text: "Hear witness", conclusion: "The witness is heard.", nextPage: 2, trait: "test-witness" },
                { text: "Fight", conclusion: "The final answer is given.", nextPage: 0, trait: "honorable", battle: { bossName: "Kage" } },
            ] },
            { title: "Proof", scene: "", speaker: "Witness", dialogue: ["Recorded"], choices: [{ text: "Return", nextPage: 0 }] },
            { title: "Witness", scene: "", speaker: "Witness", dialogue: ["Testified"], choices: [{ text: "Return", nextPage: 0 }] },
        ],
    };
    const hubContent = { schemaVersion: STORY_CONTENT_SCHEMA_VERSION, village: "Test Village", chapters: [chapter], interludes: [] } as StoryContentPayload;
    const event = storyToCreatorEvent(chapter, hubContent.village, 0);
    const played = { ...character(1), village: hubContent.village, storyVillage: hubContent.village };
    played.storyChoices = [0, 1, 2].map((index) => makeStoryChoiceReceipt(event, 0, index, event.vnPages![0].choices![index]));
    const archived = buildCompletedStoryArchive(played, hubContent)[0];
    assert.deepEqual(archived.pages.map((page) => page.title), ["Hub", "Proof", "Hub", "Witness", "Hub"]);
    assert.deepEqual(archived.decisions.map((decision) => decision.text), ["Present proof", "Hear witness", "Fight"]);
    assert.ok(archived.replayEvent.vnPages?.flatMap((page) => page.dialogue).includes("The final answer is given."));
    assert.ok(archived.replayEvent.vnPages?.some((page) => page.lines?.some((line) => line.speaker === "Narrator" && line.text === "The final answer is given.")));
});

test("an unfinished reusable hub stops transparently when its receipts are exhausted", () => {
    const chapter = {
        levelReq: 100, title: "Unfinished Hub", bossName: "Kage", bossIcon: "K", rewardXp: 0, rewardRyo: 0,
        pages: [
            { title: "Hub", scene: "", speaker: "Kage", dialogue: ["Choose"], choices: [
                { text: "Present proof", nextPage: 1, trait: "test-proof" },
                { text: "Fight", nextPage: 0, trait: "honorable", battle: { bossName: "Kage" } },
            ] },
            { title: "Proof", scene: "", speaker: "Witness", dialogue: ["Recorded"], choices: [{ text: "Return", nextPage: 0 }] },
        ],
    };
    const content = { schemaVersion: STORY_CONTENT_SCHEMA_VERSION, village: "Test Village", chapters: [chapter], interludes: [] } as StoryContentPayload;
    const event = storyToCreatorEvent(chapter, content.village, 0);
    const played = { ...character(1), village: content.village, storyVillage: content.village };
    played.storyChoices = [makeStoryChoiceReceipt(event, 0, 0, event.vnPages![0].choices![0])];
    const archived = buildCompletedStoryArchive(played, content)[0];
    assert.equal(archived.historyComplete, false);
    assert.deepEqual(archived.pages.map((page) => page.title), ["Hub", "Proof", "Hub"]);
});

test("archive does not invent a migrated branch from a later gating trait", () => {
    const chapter = {
        levelReq: 4, title: "Old Fork", bossName: "Kage", bossIcon: "K", rewardXp: 0, rewardRyo: 0,
        pages: [
            { title: "Fork", scene: "", speaker: "Kage", dialogue: ["Choose"], choices: [
                { text: "Known now", nextPage: 1, requireTrait: "later-knowledge" },
                { text: "Unknown then", nextPage: 2, forbidTrait: "later-knowledge" },
            ] },
            { title: "Known route", scene: "", speaker: "Kage", dialogue: ["One history"] },
            { title: "Unknown route", scene: "", speaker: "Kage", dialogue: ["Another history"] },
        ],
    };
    const migratedContent = { schemaVersion: STORY_CONTENT_SCHEMA_VERSION, village: "Test Village", chapters: [chapter], interludes: [] } as StoryContentPayload;
    const migrated = { ...character(1, ["later-knowledge"]), village: "Test Village", storyVillage: "Test Village" };
    const archived = buildCompletedStoryArchive(migrated, migratedContent)[0];
    assert.equal(archived.historyComplete, false);
    assert.deepEqual(archived.pages.map((page) => page.title), ["Fork"]);
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

test("Story Hall resume selects the exact current chapter while older interludes remain queued", () => {
    const ready = { ...character(3), level: 35 };
    const ordinary = nextStoryTriggerFromContent(ready, content, []);
    assert.equal(ordinary?.eventId, "story-interlude-stormveil-village-20");
    const resumed = currentStoryChapterTriggerFromContent(ready, content);
    assert.equal(resumed?.eventId, "story-stormveil-village-35-3");
    assert.equal(resumed?.returnScreen, "storyHall");
});

test("Story Hall separates completed stories from the Living Chronicle", () => {
    assert.match(storyHallSource, /aria-label="Story Hall sections"/);
    assert.match(storyHallSource, />\s*Completed Stories\s*</);
    assert.match(storyHallSource, />\s*Living Chronicle\s*</);
    assert.match(storyHallSource, /aria-pressed=\{section === "stories"\}/);
    assert.match(storyHallSource, /aria-pressed=\{section === "chronicle"\}/);
});

test("Story Hall surfaces a durable report conflict instead of silently blocking later history", () => {
    assert.match(storyJourneySource, /permanent Chronicle record/);
    assert.match(storyJourneySource, /report\.status === "conflict"/);
});

test("Living Chronicle owns the moved progression spine and shared-world records", () => {
    assert.match(livingChronicleSource, /ONE JOURNEY · FOUR FORMS OF PROOF/);
    assert.match(livingChronicleSource, /YOUR DEEDS/);
    assert.match(livingChronicleSource, /VILLAGE RECORD/);
    assert.match(livingChronicleSource, /CLAN RECORD/);
    assert.match(livingChronicleSource, /endedVillageWarRecordsFor\(village, 3\)/);
    assert.match(livingChronicleSource, /cwListWars\(\)/);
});
