import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Character } from "../types/character";
import { MAX_LEVEL, STARTING_STAT_POINTS } from "../constants/game";
import { villages } from "../data/sectors";
import { rankFromLevel } from "./stats";
import { normalizeCharacter } from "./normalize-character";

/*
 * Characterization tests for save hydration.
 *
 * normalizeCharacter runs on EVERY player load and its output is what gets
 * re-saved, so these pin current behaviour rather than preferred behaviour. They
 * exist so the move out of App.tsx is provably behaviour-preserving, and so a
 * later edit to a clamp or a default is a deliberate, visible save migration.
 *
 * This logic shipped with no direct coverage for as long as it lived in App.tsx:
 * App imports a .webp, so node:test could never load it.
 */

function save(over: Partial<Character>): Character {
    return { name: "tester", ...over } as unknown as Character;
}

describe("level and vitals", () => {
    it("floors and clamps level into 1..MAX_LEVEL", () => {
        assert.equal(normalizeCharacter(save({ level: 7.9 })).level, 7);
        assert.equal(normalizeCharacter(save({ level: 0 })).level, 1);
        assert.equal(normalizeCharacter(save({ level: -50 })).level, 1);
        assert.equal(normalizeCharacter(save({ level: MAX_LEVEL + 999 })).level, MAX_LEVEL);
    });

    it("defaults a missing level to 1", () => {
        assert.equal(normalizeCharacter(save({})).level, 1);
    });

    it("treats the level curve as a FLOOR for max vitals, not a ceiling", () => {
        // normalizeLoadedVital takes Math.max(curve, stored). Worth pinning
        // explicitly, because "normalize" reads like it would clamp DOWN to the
        // curve and it does the opposite: a larger stored pool is grandfathered,
        // so hydration never shrinks a maximum a player legitimately holds.
        const curveOnly = normalizeCharacter(save({ level: 20 }));
        assert.ok(curveOnly.maxHp > 0);

        const bigger = normalizeCharacter(save({ level: 20, maxHp: 999_999, hp: 999_999 }));
        assert.equal(bigger.maxHp, 999_999, "a larger stored maximum survives hydration");

        const smaller = normalizeCharacter(save({ level: 20, maxHp: 1, hp: 1 }));
        assert.equal(smaller.maxHp, curveOnly.maxHp, "a stored maximum below the curve is raised to it");
    });

    it("clamps the current vital into [0, maximum]", () => {
        const over = normalizeCharacter(save({ level: 20, maxHp: 50, hp: 10_000 }));
        assert.ok(over.hp <= over.maxHp);
        assert.equal(normalizeCharacter(save({ level: 20, hp: -5 })).hp, 0);
    });
});

describe("retired XP is ballast, not a curve", () => {
    it("carries xp through untouched apart from floor/zero-clamp", () => {
        assert.equal(normalizeCharacter(save({ level: 5, xp: 123_456 })).xp, 123_456);
        assert.equal(normalizeCharacter(save({ xp: 12.7 })).xp, 12);
        assert.equal(normalizeCharacter(save({ xp: -5 })).xp, 0);
        assert.equal(normalizeCharacter(save({})).xp, 0);
    });
});

describe("defaults and caps a stored save may be missing", () => {
    it("derives rankTitle from level only when the save has none", () => {
        assert.equal(normalizeCharacter(save({ level: 30 })).rankTitle, rankFromLevel(30));
        assert.equal(normalizeCharacter(save({ level: 30, rankTitle: "Kage" })).rankTitle, "Kage");
    });

    it("falls back storyVillage → village → the first village", () => {
        assert.equal(normalizeCharacter(save({ storyVillage: "A", village: "B" })).storyVillage, "A");
        assert.equal(normalizeCharacter(save({ village: "B" })).storyVillage, "B");
        assert.equal(normalizeCharacter(save({})).storyVillage, villages[0]);
    });

    it("caps the equipped jutsu list at 15", () => {
        const ids = Array.from({ length: 40 }, (_, i) => `j${i}`);
        assert.equal(normalizeCharacter(save({ equippedJutsuIds: ids })).equippedJutsuIds.length, 15);
        assert.deepEqual(normalizeCharacter(save({ equippedJutsuIds: ids })).equippedJutsuIds, ids.slice(0, 15));
    });

    it("seeds unspentStats from the starting pool and never goes negative", () => {
        assert.equal(normalizeCharacter(save({})).unspentStats, STARTING_STAT_POINTS);
        assert.equal(normalizeCharacter(save({ unspentStats: -3 })).unspentStats, 0);
        assert.equal(normalizeCharacter(save({ unspentStats: 4.8 })).unspentStats, 4);
    });

    it("gives an empty save usable collections rather than undefined", () => {
        const fresh = normalizeCharacter(save({}));
        assert.ok(Array.isArray(fresh.pets));
        assert.ok(Array.isArray(fresh.inventory));
        // itemStacks is read as an array everywhere downstream; a non-array here
        // is the shape bug the inventory migration exists to prevent.
        assert.ok(Array.isArray(fresh.itemStacks));
    });
});

describe("idempotence", () => {
    // The property that matters most: every load re-normalizes and re-saves, so
    // any field that changed on a second pass would drift a live save on each
    // login until it broke.
    const cases: Array<[string, Partial<Character>]> = [
        ["an empty save", {}],
        ["a minimal save", { level: 12, xp: 400, village: "B" }],
        ["a lying save", { level: 900.7, maxHp: 1, hp: -20, unspentStats: -1 }],
        ["a populated save", {
            level: 44,
            xp: 9_001,
            village: "B",
            rankTitle: "Jonin",
            equippedJutsuIds: Array.from({ length: 30 }, (_, i) => `j${i}`),
            inventory: [],
            pets: [],
            storyTraits: [],
        }],
    ];

    for (const [label, input] of cases) {
        it(`is stable on a second pass for ${label}`, () => {
            const once = normalizeCharacter(save(input));
            const twice = normalizeCharacter(structuredClone(once));
            assert.deepEqual(twice, once);
        });
    }
});

describe("the caller's object is not mutated", () => {
    it("returns a new object and leaves the input save alone", () => {
        const input = save({ level: 3.7, xp: 10 });
        const before = structuredClone(input);
        const out = normalizeCharacter(input);
        assert.notEqual(out, input);
        assert.deepEqual(input, before, "hydration must not edit the caller's save in place");
    });
});
