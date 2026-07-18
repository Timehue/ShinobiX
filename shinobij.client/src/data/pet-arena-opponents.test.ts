import assert from "node:assert/strict";
import test from "node:test";
import { genericPetArenaOpponents } from "./pet-arena-opponents";

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
