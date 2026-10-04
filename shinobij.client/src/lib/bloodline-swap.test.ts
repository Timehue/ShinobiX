import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { equipOwnedBloodline, replaceCharacterBloodline } from "./bloodline-swap";
import type { Character } from "../types/character";
import type { Jutsu, SavedBloodline } from "../types/combat";
import { starterSavedBloodlines } from "../data/jutsu";

const STARTER_TECH = starterSavedBloodlines.find((entry) => entry.name === "Ashen Eyes")!.jutsus[0]!.id;

const jutsu = (id: string): Jutsu => ({
    id,
    name: id,
    type: "Ninjutsu",
    element: "Fire",
    ap: 60,
    range: 4,
    effectPower: 40,
    cooldown: 7,
    currentCooldown: 0,
    chakraCost: 100,
    staminaCost: 100,
    target: "OPPONENT",
    method: "SINGLE",
    tags: [],
});

const bloodline = (id: string, ids: string[]): SavedBloodline => ({
    id,
    name: id,
    rank: "A Rank",
    specialElement: "Ember",
    jutsus: ids.map(jutsu),
    totalPoints: 0,
});

const character = (overrides: Partial<Character> = {}): Character => ({
    name: "AuditNinja",
    bloodline: "Ashen Eyes",
    equippedBloodlineId: "old-custom",
    equippedJutsuIds: [STARTER_TECH, "old-tech", "universal-tech"],
    jutsuMastery: [
        { jutsuId: STARTER_TECH, level: 24, xp: 8 },
        { jutsuId: "old-tech", level: 31, xp: 4 },
        { jutsuId: "universal-tech", level: 12, xp: 2 },
    ],
    ...overrides,
} as Character);

describe("replaceCharacterBloodline", () => {
    it("removes inactive starter and custom techniques while preserving universal slots and mastery", () => {
        const before = character();
        const result = replaceCharacterBloodline(
            before,
            bloodline("new-custom", ["new-tech"]),
            [bloodline("old-custom", ["old-tech"])],
        );

        assert.equal(result.equippedBloodlineId, "new-custom");
        assert.deepEqual(result.equippedJutsuIds, ["universal-tech"]);
        assert.deepEqual(result.jutsuMastery, before.jutsuMastery);
        assert.notEqual(result.jutsuMastery, before.jutsuMastery);
    });

    it("editing the equipped bloodline keeps unchanged techniques equipped and at their trained mastery", () => {
        const before = character({
            equippedJutsuIds: [STARTER_TECH, "old-tech", "retired-tech"],
            jutsuMastery: [
                { jutsuId: STARTER_TECH, level: 19, xp: 1 },
                { jutsuId: "old-tech", level: 42, xp: 9 },
                { jutsuId: "retired-tech", level: 7, xp: 0 },
            ],
        });
        const result = replaceCharacterBloodline(
            before,
            bloodline("old-custom", ["old-tech", "new-tech"]),
            [bloodline("old-custom", ["old-tech", "retired-tech"])],
        );

        assert.deepEqual(result.equippedJutsuIds, ["old-tech"]);
        assert.deepEqual(result.jutsuMastery, before.jutsuMastery);
        assert.equal(result.jutsuMastery.find((row) => row.jutsuId === "old-tech")?.level, 42);
    });

    it("keeps mastery for a stored outgoing bloodline so swapping back restores progress", () => {
        const before = character();
        const result = replaceCharacterBloodline(
            before,
            bloodline("second-custom", ["second-tech"]),
            [bloodline("old-custom", ["old-tech"]), bloodline("second-custom", ["second-tech"])],
        );

        assert.equal(result.jutsuMastery.some((row) => row.jutsuId === "old-tech" && row.level === 31), true);
    });

    it("can switch back to the original starter without keeping custom jutsu equipped", () => {
        const original = starterSavedBloodlines.find((entry) => entry.name === "Ashen Eyes")!;
        const result = replaceCharacterBloodline(character(), original, [bloodline("old-custom", ["old-tech"])]);
        assert.equal(result.equippedBloodlineId, original.id);
        assert.deepEqual(result.equippedJutsuIds, [STARTER_TECH, "universal-tech"]);
        assert.equal(result.jutsuMastery.find((row) => row.jutsuId === "old-tech")?.level, 31);
    });
});

describe("equipOwnedBloodline", () => {
    it("grants level-1 mastery only to the target's never-trained techniques", () => {
        const before = character({ jutsuMastery: [
            { jutsuId: "old-tech", level: 31, xp: 4 },
            { jutsuId: "second-trained", level: 18, xp: 6 },
        ] });
        const result = equipOwnedBloodline(
            before,
            bloodline("second-custom", ["second-trained", "second-new"]),
            [bloodline("old-custom", ["old-tech"]), bloodline("second-custom", ["second-trained", "second-new"])],
        );

        assert.equal(result.equippedBloodlineId, "second-custom");
        assert.deepEqual(result.jutsuMastery, [
            { jutsuId: "old-tech", level: 31, xp: 4 },
            { jutsuId: "second-trained", level: 18, xp: 6 },
            { jutsuId: "second-new", level: 1, xp: 0 },
        ]);
        assert.equal(before.jutsuMastery.length, 2);
    });

    it("drops the outgoing kit from the loadout like a plain swap", () => {
        const original = starterSavedBloodlines.find((entry) => entry.name === "Ashen Eyes")!;
        const result = equipOwnedBloodline(character(), original, [bloodline("old-custom", ["old-tech"])]);
        assert.equal(result.equippedBloodlineId, original.id);
        assert.deepEqual(result.equippedJutsuIds, [STARTER_TECH, "universal-tech"]);
        assert.equal(result.jutsuMastery.find((row) => row.jutsuId === STARTER_TECH)?.level, 24);
    });
});

describe("Bloodline Maker flow wiring", () => {
    it("keeps edit, close, and Awakening transitions in the dedicated hook", () => {
        const flow = readFileSync(new URL("./use-bloodline-maker-flow.ts", import.meta.url), "utf8");
        const app = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");

        assert.match(flow, /setEditingBloodline\(bloodline\)[\s\S]+setInitialRank\(bloodline\.rank\)[\s\S]+setScreen\("bloodlineMaker"\)/);
        assert.match(flow, /setAcademyAwakeningRequested\(true\)[\s\S]+setScreen\("centralHub"\)/);
        assert.match(app, /useBloodlineMakerFlow\(setScreen, setAcademyAwakeningRequested\)/);
        assert.doesNotMatch(app, /setBloodlineMaker(?:Initial|Rank|Editing)/);
    });
});
