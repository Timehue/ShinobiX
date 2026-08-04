import { test } from "node:test";
import assert from "node:assert/strict";
import { ULTRA_PET_TRAITS } from "../../../shared/shrines";
import { petTraits, ultraPetTraits } from "../data/pet-config";
import { applyPetTraitBonuses } from "./pet-balance";
import type { Pet } from "../types/pet";

const basePet: Pet = {
    id: "trait-test",
    name: "Trait Test",
    image: "",
    rarity: "standard",
    level: 1,
    xp: 0,
    hp: 100,
    attack: 100,
    defense: 100,
    speed: 100,
    maxLevel: 100,
    jutsus: [],
    unlockedForPve: false,
    moveRange: 3,
};

test("Shrine apex traits stay separate from ordinary pet rolls", () => {
    assert.deepEqual(ultraPetTraits, [...ULTRA_PET_TRAITS]);
    for (const trait of ULTRA_PET_TRAITS) assert.ok(!petTraits.includes(trait));
});

test("Fateweaver and Hollowborn apply their exact base stat packages", () => {
    const fateweaver = applyPetTraitBonuses(basePet, "Fateweaver");
    assert.deepEqual(
        [fateweaver.hp, fateweaver.attack, fateweaver.defense, fateweaver.speed],
        [120, 120, 120, 120],
    );

    const hollowborn = applyPetTraitBonuses(basePet, "Hollowborn");
    assert.deepEqual(
        [hollowborn.hp, hollowborn.attack, hollowborn.defense, hollowborn.speed],
        [105, 105, 105, 105],
    );

    assert.deepEqual(applyPetTraitBonuses(basePet, "Boonbringer"), basePet);
});
