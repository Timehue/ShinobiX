import { test } from "node:test";
import assert from "node:assert/strict";
import type { Character } from "../types/character";
import { baseStats } from "./stats";
import { rankFromLevel } from "./stats";
import { jutsuLevelCapForLevel, statCapForLevel } from "../constants/game";
import { levelProgress } from "./character-progress";
import {
    buildLogbookObjectives,
    currentLogbookObjective,
    examProgressionImpact,
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
    const awakening = objectives[0]?.requirements.find((requirement) => requirement.label === "Awaken your first element");
    assert.equal(awakening?.goScreen, "centralHub");
    assert.equal(awakening?.goLabel, "Awakening Stone");
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
    assert.equal(profession?.goScreen, "professions");

    const withProfession = buildLogbookObjectives(makeCharacter({
        level: 13,
        academyChecklistClaimed: true,
        totalMissionsCompleted: 7,
        totalAiKills: 7,
        profession: "healer",
    })).find((o) => o.id === "ready-for-genin");
    assert.equal(withProfession?.requirements.find((r) => r.label === "Choose a profession")?.progress, 1);
});

test("profession CTA stays hidden until the level-13 picker can render", () => {
    const ready = buildLogbookObjectives(makeCharacter({
        level: 10,
        academyChecklistClaimed: true,
        totalMissionsCompleted: 7,
        totalAiKills: 7,
    })).find((o) => o.id === "ready-for-genin");
    const profession = ready?.requirements.find((r) => r.label === "Choose a profession");
    assert.equal(profession?.goScreen, undefined);
    assert.equal(profession?.goLabel, undefined);
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

// Level 30 is the milestone most likely to read as broken progression, because
// two different things called "Chunin" disagree by nine levels: the RANK starts
// at 30 (rankFromLevel bands 80/50/30/15) while the Chunin Advancement Exam is a
// level-39 hold (shared/progression-holds.ts). A player who skipped the Genin
// exam is therefore titled Chunin and still held by a Genin gate.
test("level 30 is titled Chunin but still held by the Genin gate when that exam is unpassed", () => {
    assert.equal(rankFromLevel(29), "Genin");
    assert.equal(rankFromLevel(30), "Chunin");

    const c = makeCharacter({ level: 30 });
    assert.equal(rankFromLevel(c.level), "Chunin");

    // The hold names the exam, so the Logbook can say WHY rather than just stalling.
    assert.equal(levelProgress(c).heldBy, "Genin Advancement Exam");

    // The Chunin exam must not appear yet — offering it here would tell a held
    // player to sit an exam they cannot reach for another nine levels.
    const objectives = buildLogbookObjectives(c);
    assert.deepEqual(objectives.filter((o) => o.kind === "exam").map((o) => o.examKey), ["genin"]);

    // Correct objective prioritised, and it carries somewhere to go.
    const current = currentLogbookObjective(c);
    assert.equal(current?.examKey, "genin");
    assert.equal(current?.progressionImpact, "blocking");
    assert.equal(current?.unlockLevel, 20);
    assert.ok(current?.requirements.some((r) => r.goScreen === "training"));
    assert.ok(current?.requirements.some((r) => r.goScreen === "missions"));
});

test("clearing the Genin exam frees level 30 and leaves nothing pending until 39", () => {
    const c = makeCharacter({ level: 30, examsPassed: ["genin"] });
    assert.equal(levelProgress(c).heldBy, null);
    assert.equal(currentLogbookObjective(c), null);

    // Still nothing new unlocked at 30 - the next hold is the level-39 Chunin gate.
    assert.deepEqual(buildLogbookObjectives(c).filter((o) => o.kind === "exam").map((o) => o.examKey), ["genin"]);
    assert.equal(currentLogbookObjective(makeCharacter({ level: 39, examsPassed: ["genin"] }))?.examKey, "chunin");
});

test("profession does not change what level 30 asks for", () => {
    // The profession checkpoint belongs to the level-13 Ready for Genin objective.
    // Pinned here so it cannot leak into the Chunin band as a second gate.
    const ids = (c: Character) => buildLogbookObjectives(c).map((o) => o.id);
    assert.deepEqual(ids(makeCharacter({ level: 30 })), ["exam-genin"]);
    assert.deepEqual(ids(makeCharacter({ level: 30, profession: "medic" } as Partial<Character>)), ["exam-genin"]);
});

test("only the two canonical progression holds can become the current exam", () => {
    assert.equal(examProgressionImpact("genin"), "blocking");
    assert.equal(examProgressionImpact("chunin"), "blocking");
    assert.equal(examProgressionImpact("jonin"), "prestige");
    assert.equal(examProgressionImpact("specialJonin"), "prestige");

    const veteran = makeCharacter({ level: 80, examsPassed: ["genin", "chunin"] });
    const optional = buildLogbookObjectives(veteran).filter((objective) => objective.progressionImpact === "prestige");
    assert.deepEqual(optional.map((objective) => objective.examKey), ["jonin", "specialJonin"]);
    assert.equal(currentLogbookObjective(veteran), null);
});

test("level 80 and level 100 progression does not depend on optional prestige stamps", () => {
    for (const level of [80, 100]) {
        const character = makeCharacter({ level, examsPassed: ["genin", "chunin"], unspentStats: 0 });
        assert.equal(rankFromLevel(level), "Special Jonin");
        assert.equal(levelProgress(character).heldBy, null);
        assert.equal(statCapForLevel(level), 2500);
        assert.equal(jutsuLevelCapForLevel(level), 50);
    }
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
    const notKage = buildLogbookObjectives(base).find((objective) => objective.examKey === "specialJonin");
    assert.equal(notKage?.examKey, "specialJonin");
    assert.equal(notKage?.progressionImpact, "prestige");
    assert.ok(!objectiveComplete(notKage!), "not Kage/Elder is incomplete");

    const asKage = buildLogbookObjectives(base, { isKage: true }).find((objective) => objective.examKey === "specialJonin");
    assert.ok(objectiveComplete(asKage!), "seated Kage satisfies the standing requirement");
    assert.equal(currentLogbookObjective(base, { isKage: true }), null, "optional prestige never owns the required next objective");
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
