import { test } from "node:test";
import assert from "node:assert/strict";
import { PET_COMBAT_MODEL_IDS, hasPetCombatModel, petCombatModel } from "./pet-3d-models.ts";
import { ROSTER_MODEL_ASSET_REVISION } from "./pet-3d-roster.ts";

const pet = (id: string, evolutionStage?: 0 | 1 | 2, rarity: "standard" | "rare" | "legendary" = "standard") => ({ id, evolutionStage, rarity });

test("all ten evolved starter forms have a combat model", () => {
    assert.equal(PET_COMBAT_MODEL_IDS.length, 10);
    for (const element of ["fire", "water", "wind", "lightning", "earth"]) {
        const rare = petCombatModel(pet(`starter-${element}`, 1, "rare"));
        const legendary = petCombatModel(pet(`starter-${element}`, 2, "legendary"));
        if (element === "fire") {
            assert.equal(rare?.url, "/pet-models/ember-wolf-rigged.gltf");
            assert.equal(legendary?.url, "/pet-models/ember-wolf-rigged.gltf");
        } else if (element === "earth") {
            assert.equal(rare?.url, "/pet-models/starter-earth-r.glb");
            assert.equal(legendary?.url, "/pet-models/starter-earth-r.glb");
        } else {
            assert.equal(rare?.url, `/pet-models/starter-${element}-r.glb`);
            assert.equal(legendary?.url, `/pet-models/starter-${element}-l.glb`);
        }
        assert.ok((legendary?.targetHeight ?? 0) > (rare?.targetHeight ?? 0));
    }
});

test("base starters and unrelated pets keep the safe standee fallback", () => {
    assert.equal(petCombatModel(pet("starter-fire", 0)), null);
    assert.equal(hasPetCombatModel(pet("unmodeled-event-pet")), false);
});

test("all built-in Coliseum AI opponents resolve to approved roster models", () => {
    assert.equal(petCombatModel(pet("generic-ai-pet-sparrow"))?.url, `/pet-models/roster/standard-44.glb?v=${ROSTER_MODEL_ASSET_REVISION}`);
    assert.equal(petCombatModel(pet("generic-ai-pet-guardhound"))?.url, `/pet-models/roster/rare-24.glb?v=${ROSTER_MODEL_ASSET_REVISION}`);
    assert.equal(petCombatModel(pet("generic-ai-pet-emberlynx"))?.url, `/pet-models/roster/rare-26.glb?v=${ROSTER_MODEL_ASSET_REVISION}`);
});

test("timestamped encounter clones retain their canonical combat model", () => {
    assert.equal(petCombatModel(pet("mythic-7-1784319745000"))?.url, `/pet-models/roster/mythic-7.glb?v=${ROSTER_MODEL_ASSET_REVISION}`);
});

test("legacy evolved saves infer the model from rarity", () => {
    assert.equal(petCombatModel(pet("starter-water", undefined, "rare"))?.url, "/pet-models/starter-water-r.glb");
    assert.equal(petCombatModel(pet("starter-water", undefined, "legendary"))?.url, "/pet-models/starter-water-l.glb");
});
