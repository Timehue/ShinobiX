import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { replaceCharacterBloodline } from "./bloodline-swap";
import type { Character } from "../types/character";
import type { Jutsu, SavedBloodline } from "../types/combat";

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
    equippedJutsuIds: ["starter-tech", "old-tech", "universal-tech"],
    jutsuMastery: [
        { jutsuId: "starter-tech", level: 24, xp: 8 },
        { jutsuId: "old-tech", level: 31, xp: 4 },
        { jutsuId: "universal-tech", level: 12, xp: 2 },
    ],
    ...overrides,
} as Character);

describe("replaceCharacterBloodline", () => {
    it("preserves starter and universal loadout/mastery while removing the outgoing custom kit", () => {
        const before = character();
        const result = replaceCharacterBloodline(
            before,
            bloodline("new-custom", ["new-tech"]),
            [bloodline("old-custom", ["old-tech"])],
        );

        assert.equal(result.equippedBloodlineId, "new-custom");
        assert.deepEqual(result.equippedJutsuIds, ["starter-tech", "universal-tech"]);
        assert.deepEqual(result.jutsuMastery, before.jutsuMastery);
        assert.notEqual(result.jutsuMastery, before.jutsuMastery);
    });

    it("editing the equipped bloodline keeps unchanged techniques equipped and at their trained mastery", () => {
        const before = character({
            equippedJutsuIds: ["starter-tech", "old-tech", "retired-tech"],
            jutsuMastery: [
                { jutsuId: "starter-tech", level: 19, xp: 1 },
                { jutsuId: "old-tech", level: 42, xp: 9 },
                { jutsuId: "retired-tech", level: 7, xp: 0 },
            ],
        });
        const result = replaceCharacterBloodline(
            before,
            bloodline("old-custom", ["old-tech", "new-tech"]),
            [bloodline("old-custom", ["old-tech", "retired-tech"])],
        );

        assert.deepEqual(result.equippedJutsuIds, ["starter-tech", "old-tech"]);
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
});
