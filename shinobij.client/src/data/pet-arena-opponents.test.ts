import assert from "node:assert/strict";
import test from "node:test";
import { genericPetArenaOpponents, isGenericPetOpponent } from "./pet-arena-opponents";
import type { Pet } from "../types/pet";

test("built-in Coliseum opponents have explicit elemental identities and hero moves", () => {
    const expected = new Map([
        ["generic-ai-pet-sparrow", "Wind"],
        ["generic-ai-pet-guardhound", "Earth"],
        ["generic-ai-pet-emberlynx", "Fire"],
    ]);

    assert.equal(genericPetArenaOpponents.length, expected.size);
    for (const { pet } of genericPetArenaOpponents) {
        assert.equal(pet.element, expected.get(pet.id), `${pet.name} must not fall back to neutral VFX`);
        const signature = pet.jutsus.find((move) => move.signature);
        assert.ok(signature, `${pet.name} needs a cinematic signature move`);
        assert.ok((signature.power ?? 0) > 0, `${pet.name}'s signature must create a visible combat beat`);
    }
});

test("every sealed floor-specific Hollow Hound stays on the player-controlled PvE path", () => {
    const hound = (name: string, id = "mythic-4-1234567890123") => ({
        ...genericPetArenaOpponents[0].pet,
        id,
        name,
    }) as Pet;

    for (const name of [
        "Ashfang Hollow Hound",
        "Veilrunner Hollow Hound",
        "Shrineback Hollow Hound",
        "Riftmaw Hollow Hound",
        "Alpha's Fang",
        "Hollow Hound Alpha",
        "Elite Veilrunner Hollow Hound",
        "Ambushing Riftmaw Hollow Hound",
    ]) {
        assert.equal(isGenericPetOpponent(hound(name)), true, `${name} must use tactical PvE control`);
    }
    assert.equal(isGenericPetOpponent(hound("Abyssal Oni Hound")), false, "the ordinary Oni Hound must not be relabeled as a Gate encounter");
    assert.equal(isGenericPetOpponent(hound("Ashfang Hollow Hound", "mythic-4")), false, "only a sealed encounter id may opt into Gate PvE");
});
