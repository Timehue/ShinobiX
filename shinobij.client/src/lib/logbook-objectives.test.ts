import { test } from "node:test";
import assert from "node:assert/strict";
import type { Character } from "../types/character";
import { baseStats } from "./stats";
import {
    buildLogbookObjectives,
    currentLogbookObjective,
    objectiveComplete,
} from "./logbook-objectives";
import { buildJourneyGuide } from "./journey-guide";
import { onboardingStepAtLeast } from "./onboarding-step";

// A minimal but type-complete save: only the fields the objective builder reads
// matter; everything else is filled to satisfy the Character shape loosely via a
// cast, mirroring how the screen passes a real save.
function makeCharacter(over: Partial<Character> = {}): Character {
    return {
        name: "Rill",
        village: "Frostfang",
        level: 1,
        stats: baseStats(),
        elements: [],
        element: "",
        equippedJutsuIds: [],
        examsPassed: [],
        ...over,
    } as unknown as Character;
}

test("a fresh Academy Student gets the Academy Training objective first", () => {
    const c = makeCharacter({ level: 3 });
    const objectives = buildLogbookObjectives(c);
    assert.equal(objectives[0]?.kind, "academy");
    assert.equal(objectives[0]?.title, "Academy Training");
    assert.ok(!objectives.some((o) => o.kind === "exam"));
    assert.equal(currentLogbookObjective(c)?.title, "Academy Training");
});

test("claiming the Academy reward hides the checklist and moves to first steps", () => {
    const c = makeCharacter({ level: 3, academyChecklistClaimed: true });
    assert.ok(!buildLogbookObjectives(c).some((o) => o.kind === "academy"));
    assert.equal(currentLogbookObjective(c)?.id, "first-steps");
});

test("Academy Training hides once the player outgrows Academy rank", () => {
    const c = makeCharacter({ level: 15 });
    const objectives = buildLogbookObjectives(c);
    assert.ok(!objectives.some((o) => o.kind === "academy"));
    assert.equal(currentLogbookObjective(c)?.id, "first-steps");
});

test("early chapters guide Academy to Genin without unlocking exams early", () => {
    const c = makeCharacter({
        level: 10,
        academyChecklistClaimed: true,
        equippedJutsuIds: ["a", "b", "c", "d"],
    });
    const objectives = buildLogbookObjectives(c);
    assert.deepEqual(objectives.filter((o) => o.kind === "chapter").map((o) => o.id), [
        "first-steps",
        "field-training",
        "ready-for-genin",
    ]);
    assert.ok(!objectives.some((o) => o.kind === "exam"));
    assert.equal(currentLogbookObjective(c)?.id, "first-steps");
});

test("Ready for Genin includes the level-13 profession checkpoint", () => {
    const ready = buildLogbookObjectives(makeCharacter({
        level: 13,
        academyChecklistClaimed: true,
        totalMissionsCompleted: 7,
        totalAiKills: 7,
    })).find((o) => o.id === "ready-for-genin");
    const profession = ready?.requirements.find((r) => r.label === "Choose a profession");
    assert.equal(profession?.target, 1);
    assert.equal(profession?.goScreen, "professionPicker");

    const withProfession = buildLogbookObjectives(makeCharacter({
        level: 13,
        academyChecklistClaimed: true,
        totalMissionsCompleted: 7,
        totalAiKills: 7,
        profession: "healer",
    })).find((o) => o.id === "ready-for-genin");
    assert.equal(withProfession?.requirements.find((r) => r.label === "Choose a profession")?.progress, 1);
});

test("rank exams unlock by level and are ordered low to high", () => {
    const examKeys = (c: Character) =>
        buildLogbookObjectives(c).filter((o) => o.kind === "exam").map((o) => o.examKey);
    assert.deepEqual(examKeys(makeCharacter({ level: 19 })), []);
    assert.deepEqual(examKeys(makeCharacter({ level: 20 })), ["genin"]);
    assert.deepEqual(examKeys(makeCharacter({ level: 38 })), ["genin"]);
    assert.deepEqual(examKeys(makeCharacter({ level: 39 })), ["genin", "chunin"]);
    assert.deepEqual(examKeys(makeCharacter({ level: 49 })), ["genin", "chunin"]);
    assert.deepEqual(examKeys(makeCharacter({ level: 50 })), ["genin", "chunin", "jonin"]);
    assert.deepEqual(examKeys(makeCharacter({ level: 80 })), ["genin", "chunin", "jonin", "specialJonin"]);
});

test("current objective is the lowest unlocked exam not yet passed", () => {
    const c = makeCharacter({ level: 39, examsPassed: ["genin"] });
    assert.equal(currentLogbookObjective(c)?.examKey, "chunin");
});

test("current objective is null once every unlocked exam is passed", () => {
    const c = makeCharacter({ level: 25, examsPassed: ["genin"] });
    assert.equal(currentLogbookObjective(c), null);
});

test("requirement progress reads the save's counters", () => {
    const c = makeCharacter({
        level: 39,
        examsPassed: ["genin"],
        elements: ["Fire", "Water"],
        element: "Fire",
        totalMissionsCompleted: 50,
        totalTilesExplored: 100,
        clan: "Emberfall",
        defeatedAiIds: ["builtin-ai-exam-proctor"],
    });
    const chunin = currentLogbookObjective(c);
    assert.equal(chunin?.examKey, "chunin");
    assert.ok(objectiveComplete(chunin!), "all Chunin requirements satisfied");
});

test("Genin and Chunin exam objectives match the real XP hold levels", () => {
    const genin = buildLogbookObjectives(makeCharacter({ level: 20 })).find((o) => o.examKey === "genin");
    assert.equal(genin?.unlockLevel, 20);
    assert.equal(genin?.requirements[0]?.target, 20);

    const chunin = buildLogbookObjectives(makeCharacter({ level: 39, examsPassed: ["genin"] })).find((o) => o.examKey === "chunin");
    assert.equal(chunin?.unlockLevel, 39);
    assert.equal(chunin?.requirements[0]?.target, 39);
});

test("Jonin exam waits for the actual Jonin rank band", () => {
    assert.ok(!buildLogbookObjectives(makeCharacter({ level: 49, examsPassed: ["genin", "chunin"] })).some((o) => o.examKey === "jonin"));

    const jonin = buildLogbookObjectives(makeCharacter({ level: 50, examsPassed: ["genin", "chunin"] })).find((o) => o.examKey === "jonin");
    assert.equal(jonin?.unlockLevel, 50);
});

test("Special Jonin 'Become Kage or Elder' honors the env context", () => {
    const base = makeCharacter({ level: 80, examsPassed: ["genin", "chunin", "jonin"], totalPvpKills: 100 });
    const notKage = currentLogbookObjective(base);
    assert.equal(notKage?.examKey, "specialJonin");
    assert.ok(!objectiveComplete(notKage!), "not Kage/Elder is incomplete");

    const asKage = currentLogbookObjective(base, { isKage: true });
    assert.ok(objectiveComplete(asKage!), "seated Kage satisfies the standing requirement");
});

test("Journey Guide starts fresh Academy players at training", () => {
    const guide = buildJourneyGuide(makeCharacter({ level: 3, onboardingStep: "academyIntro" }));
    assert.equal(guide.shouldShow, true);
    assert.equal(guide.primaryObjective?.id, "training");
    assert.equal(guide.completedCount, 0);
});

test("Journey Guide does not replay for legacy saves with no onboarding step", () => {
    const guide = buildJourneyGuide(makeCharacter({ level: 3 }));
    assert.equal(guide.shouldShow, false);
});

test("Journey Guide treats pending combat mission claims as a completed first fight", () => {
    const guide = buildJourneyGuide(makeCharacter({
        level: 3,
        onboardingStep: "training",
        totalStatsTrained: 1,
        equippedJutsuIds: ["strike", "guard", "dash", "focus"],
        pendingCombatMissionClaims: ["combat-e-drill"],
    }));
    assert.equal(guide.objectives.find((objective) => objective.id === "combat")?.complete, true);
    assert.equal(guide.primaryObjective?.id, "mission");
});

test("Journey Guide treats the completed Academy spar as the first fight", () => {
    const guide = buildJourneyGuide(makeCharacter({
        level: 3,
        onboardingStep: "cafeteria",
    }));

    assert.equal(guide.objectives.find((objective) => objective.id === "combat")?.complete, true);
    assert.equal(guide.primaryObjective?.id, "mission");
});

test("Journey Guide follows the Academy coach after training starts", () => {
    const guide = buildJourneyGuide(makeCharacter({
        level: 3,
        onboardingStep: "jutsu",
    }));

    assert.equal(guide.objectives.find((objective) => objective.id === "training")?.complete, true);
    assert.equal(guide.objectives.find((objective) => objective.id === "combat")?.complete, false);
    assert.equal(guide.primaryObjective?.id, "jutsu");
});

test("Journey Guide does not repeat stale loadout steps after the coach reaches missions", () => {
    const guide = buildJourneyGuide(makeCharacter({
        level: 3,
        onboardingStep: "firstMission",
    }));

    assert.equal(guide.objectives.find((objective) => objective.id === "training")?.complete, true);
    assert.equal(guide.objectives.find((objective) => objective.id === "jutsu")?.complete, true);
    assert.equal(guide.objectives.find((objective) => objective.id === "combat")?.complete, true);
    assert.equal(guide.primaryObjective?.id, "mission");
});

test("Journey Guide closes once the coach has unlocked the story beat", () => {
    const guide = buildJourneyGuide(makeCharacter({
        level: 3,
        onboardingStep: "storyUnlocked",
    }));

    assert.equal(guide.primaryObjective, null);
    assert.equal(guide.shouldShow, false);
    assert.equal(guide.completedCount, guide.totalCount);
});

test("onboarding step ordering keeps legacy aliases comparable", () => {
    assert.equal(onboardingStepAtLeast("spar", "training"), true);
    assert.equal(onboardingStepAtLeast("tour", "training"), true);
    assert.equal(onboardingStepAtLeast("firstMission", "jutsu"), true);
    assert.equal(onboardingStepAtLeast("storyUnlocked", "sectorReturn"), true);
    assert.equal(onboardingStepAtLeast("", "academyIntro"), true);
});

test("Journey Guide hides once every first step is complete", () => {
    const guide = buildJourneyGuide(makeCharacter({
        level: 3,
        onboardingStep: "logbook",
        totalStatsTrained: 1,
        equippedJutsuIds: ["strike", "guard", "dash", "focus"],
        totalAiKills: 1,
        totalMissionsCompleted: 1,
        academyChecklistClaimed: true,
    }));
    assert.equal(guide.primaryObjective, null);
    assert.equal(guide.shouldShow, false);
    assert.equal(guide.completedCount, guide.totalCount);
});
