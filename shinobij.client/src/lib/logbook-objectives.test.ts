import { test } from "node:test";
import assert from "node:assert/strict";
import type { Character } from "../types/character";
import { baseStats } from "./stats";
import {
    buildLogbookObjectives,
    currentLogbookObjective,
    objectiveComplete,
} from "./logbook-objectives";

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
