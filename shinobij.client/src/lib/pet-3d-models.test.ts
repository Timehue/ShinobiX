import { test } from "node:test";
import assert from "node:assert/strict";
import { PET_COMBAT_MODEL_IDS, hasPetCombatModel, petCombatModel } from "./pet-3d-models.ts";

const pet = (id: string, evolutionStage?: 0 | 1 | 2, rarity: "standard" | "rare" | "legendary" = "standard") => ({ id, evolutionStage, rarity });

test("all ten evolved starter forms have a combat model", () => {
    assert.equal(PET_COMBAT_MODEL_IDS.length, 10);
    for (const element of ["fire", "water", "wind", "lightning", "earth"]) {
        const rare = petCombatModel(pet(`starter-${element}`, 1, "rare"));
        const legendary = petCombatModel(pet(`starter-${element}`, 2, "legendary"));
        if (element === "fire") {
            assert.equal(rare?.url, "/pet-models/ember-wolf-rigged.gltf");
            assert.equal(legendary?.url, "/pet-models/ember-wolf-rigged.gltf");
        } else {
            assert.equal(rare?.url, `/pet-models/starter-${element}-r.glb`);
            assert.equal(legendary?.url, `/pet-models/starter-${element}-l.glb`);
        }
        assert.ok((legendary?.targetHeight ?? 0) > (rare?.targetHeight ?? 0));
    }
});

test("base starters and unrelated pets keep the safe standee fallback", () => {
    assert.equal(petCombatModel(pet("starter-fire", 0)), null);
    assert.equal(hasPetCombatModel(pet("generic-ai-pet-emberlynx")), false);
});

test("legacy evolved saves infer the model from rarity", () => {
    assert.equal(petCombatModel(pet("starter-water", undefined, "rare"))?.url, "/pet-models/starter-water-r.glb");
    assert.equal(petCombatModel(pet("starter-water", undefined, "legendary"))?.url, "/pet-models/starter-water-l.glb");
});
