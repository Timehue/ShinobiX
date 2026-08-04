import assert from "node:assert/strict";
import test from "node:test";
import { breedingOddsForPets, clientPetBreedingBlocker, formatBreedingDuration, BRED_APEX_TRAIT_CHANCE_PERCENT, PET_BREEDING_MIN_LEVEL } from "./pet-breeding";
import type { Character } from "../types/character";
import type { Pet } from "../types/pet";

const parent = (id: string, templateId: string): Pet => ({ id, templateId, name: id, rarity: "standard", level: PET_BREEDING_MIN_LEVEL, xp: 0, maxLevel: 100, hp: 1, attack: 1, defense: 1, speed: 1, jutsus: [], unlockedForPve: false, element: "Fire", breedingUsesRemaining: 5, breedingUsesMax: 5 });

test("client odds mirror the exact server table", () => {
    assert.equal(BRED_APEX_TRAIT_CHANCE_PERCENT, 0.5);
    assert.deepEqual(breedingOddsForPets(parent("p1", "standard-0"), parent("p2", "standard-6")), { parent1: 45, parent2: 45, alternate: 9, randomNonStandard: 1, chromatic: 0.05, apexTrait: 0.5 });
});

test("all five breeding-only Mythics appear in their intended 9% parent-pair preview", () => {
    const pairs = [
        ["Fire", "mythic-3", "mythic-5"],
        ["Water", "mythic-2", "mythic-6"],
        ["Wind", "mythic-0", "mythic-7"],
        ["Lightning", "mythic-1", "mythic-8"],
        ["Earth", "mythic-4", "mythic-9"],
    ] as const;
    for (const [element, firstTemplate, secondTemplate] of pairs) {
        const first = { ...parent(`${firstTemplate}:owned`, firstTemplate), rarity: "mythic" as const, element };
        const second = { ...parent(`${secondTemplate}:owned`, secondTemplate), rarity: "mythic" as const, element };
        assert.deepEqual(
            breedingOddsForPets(first, second),
            { parent1: 45, parent2: 45, alternate: 9, randomNonStandard: 1, chromatic: 0.05, apexTrait: 0.5 },
            `${element} Mythic pair should expose its breeding-only alternate`,
        );
    }
});

test("client blocker explains active and committed pets", () => {
    const pet = parent("p1", "standard-0");
    const character = { pets: [pet], activePetId: "p1" } as Character;
    assert.equal(clientPetBreedingBlocker(character, pet), "Active PvE pet");
    character.activePetId = undefined;
    character.petBreeding = { sessionId: "breed", state: "breeding", parentIds: ["p1", "p2"], parentNames: ["One", "Two"], parentElement: "Fire", startedAt: 0, readyAt: Date.now() + 10_000, rulesVersion: 1 };
    assert.equal(clientPetBreedingBlocker(character, pet), "Already in the barn");
    assert.equal(formatBreedingDuration(3_661_000), "01:01:01");
});

test("client blocker clearly identifies a protected companion even when its counter exists", () => {
    const pet = { ...parent("starter-fire", "starter-fire"), breedable: false, breedingUsesRemaining: 8, breedingUsesMax: 8 };
    const character = { pets: [pet] } as Character;
    assert.equal(clientPetBreedingBlocker(character, pet), "Protected companion");
});

test("client blocker requires level 50 before a pet can breed", () => {
    const pet = { ...parent("p1", "standard-0"), level: 49 };
    const character = { pets: [pet] } as Character;
    assert.equal(clientPetBreedingBlocker(character, pet), "Requires level 50");
    assert.equal(clientPetBreedingBlocker(character, { ...pet, level: 50 }), null);
});
