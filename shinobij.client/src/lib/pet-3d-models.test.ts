import { test } from "node:test";
import assert from "node:assert/strict";
import {
    PET_COMBAT_MODEL_IDS,
    STARTER_MODEL_ASSET_REVISION,
    hasPetCombatModel,
    petCloseupPresentationModel,
    petCombatModel,
    petVictoryArcHeight,
} from "./pet-3d-models.ts";
import { APPROVED_ROSTER_MODEL_IDS, ROSTER_MODEL_ASSET_REVISION, ROSTER_MODEL_PROFILES } from "./pet-3d-roster.ts";
import { PET_SHOWDOWN_ANIMATION_ASSET_REVISION } from "./pet-showdown-animation-assets.ts";

const pet = (id: string, evolutionStage?: 0 | 1 | 2, rarity: "standard" | "rare" | "legendary" = "standard") => ({ id, evolutionStage, rarity });

test("all five base starter forms have an approved combat model", () => {
    assert.equal(PET_COMBAT_MODEL_IDS.length, 15);
    for (const element of ["fire", "water", "wind", "lightning", "earth"]) {
        const base = petCombatModel(pet(`starter-${element}`, 0));
        const rare = petCombatModel(pet(`starter-${element}`, 1, "rare"));
        if (element === "earth") {
            assert.equal(base?.url, `/pet-models/roster/standard-5.glb?v=${ROSTER_MODEL_ASSET_REVISION}`);
        } else {
            assert.equal(base?.url, `/pet-models/starter-${element}.glb?v=${STARTER_MODEL_ASSET_REVISION}`);
        }
        assert.ok((base?.targetHeight ?? Infinity) < (rare?.targetHeight ?? 0));
    }
});

test("Pebble Tortoise replaces the duplicate-head-shell asset with the reviewed one-shell rig", () => {
    const pebble = petCombatModel({ ...pet("starter-earth", 0), name: "Pebble Tortoise" });
    assert.equal(pebble?.visualId, "standard-5");
    assert.equal(pebble?.identityVisualId, "starter-earth", "Pebble keeps its Earth VFX identity");
    assert.equal(pebble?.profile, "biped");
    assert.equal(pebble?.targetHeight, 1.95, "the replacement keeps Pebble's starter scale");
});

test("all ten evolved starter forms have a combat model", () => {
    for (const element of ["fire", "water", "wind", "lightning", "earth"]) {
        const rare = petCombatModel(pet(`starter-${element}`, 1, "rare"));
        const legendary = petCombatModel(pet(`starter-${element}`, 2, "legendary"));
        if (element === "fire" || element === "lightning") {
            assert.equal(rare?.url, `/pet-models/starter-${element}-r.glb?v=${STARTER_MODEL_ASSET_REVISION}`);
            assert.equal(legendary?.url, `/pet-models/showdown-v2/starter-${element}-l.glb?v=${PET_SHOWDOWN_ANIMATION_ASSET_REVISION}`);
        } else if (element === "water") {
            assert.equal(rare?.url, `/pet-models/starter-water-r.glb?v=${STARTER_MODEL_ASSET_REVISION}`);
            assert.equal(legendary?.url, `/pet-models/starter-water-l.glb?v=${STARTER_MODEL_ASSET_REVISION}`);
        } else {
            assert.equal(rare?.url, `/pet-models/starter-${element}-r.glb?v=${STARTER_MODEL_ASSET_REVISION}`);
            assert.equal(legendary?.url, `/pet-models/starter-${element}-l.glb?v=${STARTER_MODEL_ASSET_REVISION}`);
        }
        assert.ok((legendary?.targetHeight ?? 0) > (rare?.targetHeight ?? 0));
    }
});

test("the four-pet Showdown lineup resolves to its species-authored animation assets", () => {
    assert.equal(
        petCombatModel({ ...pet("rare-1", undefined, "rare"), name: "Frost Hare" })?.url,
        `/pet-models/showdown-v2/rare-1.glb?v=${PET_SHOWDOWN_ANIMATION_ASSET_REVISION}`,
    );
    assert.equal(
        petCombatModel({ ...pet("standard-7"), name: "Ashen Crow" })?.url,
        `/pet-models/showdown-v2/standard-7.glb?v=${PET_SHOWDOWN_ANIMATION_ASSET_REVISION}`,
    );
});

test("unrelated unmodeled pets keep the safe standee fallback", () => {
    assert.equal(hasPetCombatModel(pet("unmodeled-event-pet")), false);
});

test("all built-in Coliseum AI opponents resolve to approved roster models", () => {
    assert.equal(petCombatModel(pet("generic-ai-pet-sparrow"))?.url, `/pet-models/roster/standard-44.glb?v=${ROSTER_MODEL_ASSET_REVISION}`);
    assert.equal(petCombatModel(pet("generic-ai-pet-guardhound"))?.url, `/pet-models/roster/rare-24.glb?v=${ROSTER_MODEL_ASSET_REVISION}`);
    assert.equal(petCombatModel(pet("generic-ai-pet-emberlynx"))?.url, `/pet-models/roster/rare-26.glb?v=${ROSTER_MODEL_ASSET_REVISION}`);
});

test("all 145 approved roster models have a certified motion family", () => {
    assert.equal(APPROVED_ROSTER_MODEL_IDS.size, 145);
    assert.equal(Object.keys(ROSTER_MODEL_PROFILES).length, 145);
    for (const id of APPROVED_ROSTER_MODEL_IDS) {
        const profile = ROSTER_MODEL_PROFILES[id];
        assert.ok(profile, `${id} is missing a combat motion profile`);
        assert.equal(petCombatModel({ id, name: id })?.profile, profile);
    }
});

test("breeding-exclusive Mythics keep their own combat identity and model", () => {
    for (const id of ["mythic-10", "mythic-11", "mythic-12", "mythic-13", "mythic-14"]) {
        const model = petCombatModel({ id, name: id });
        assert.equal(model?.visualId, id);
        assert.equal(model?.url, `/pet-models/roster/${id}.glb?v=${ROSTER_MODEL_ASSET_REVISION}`);
    }
});

test("hatched owned-instance ids resolve their breeding Mythic template model", () => {
    for (const id of ["mythic-10", "mythic-11", "mythic-12", "mythic-13", "mythic-14"]) {
        const owned = petCombatModel({
            id: `${id}:550e8400-e29b-41d4-a716-446655440000`,
            templateId: id,
            name: `Owned ${id}`,
            rarity: "mythic",
        });
        assert.equal(owned?.visualId, id);
        assert.equal(owned?.url, `/pet-models/roster/${id}.glb?v=${ROSTER_MODEL_ASSET_REVISION}`);
    }
});

test("legacy owned-instance ids recover the roster template from their safe prefix", () => {
    const model = petCombatModel({
        id: "mythic-13:550e8400-e29b-41d4-a716-446655440000",
        name: "Legacy Thunderbloom Kirin",
        rarity: "mythic",
    });
    assert.equal(model?.visualId, "mythic-13");
    assert.equal(model?.url, `/pet-models/roster/mythic-13.glb?v=${ROSTER_MODEL_ASSET_REVISION}`);
});

test("timestamped encounter clones retain their canonical combat model", () => {
    assert.equal(petCombatModel(pet("mythic-7-1784319745000"))?.url, `/pet-models/roster/mythic-7.glb?v=${ROSTER_MODEL_ASSET_REVISION}`);
});

test("legacy evolved saves infer the model from rarity", () => {
    assert.equal(petCombatModel(pet("starter-water", undefined, "rare"))?.url, `/pet-models/starter-water-r.glb?v=${STARTER_MODEL_ASSET_REVISION}`);
    assert.equal(petCombatModel(pet("starter-water", undefined, "legendary"))?.url, `/pet-models/starter-water-l.glb?v=${STARTER_MODEL_ASSET_REVISION}`);
});

test("close-up presentation falls back only for the unapproved legendary Wind model", () => {
    assert.equal(petCloseupPresentationModel(pet("starter-wind", 0))?.visualId, "starter-wind");
    assert.equal(petCloseupPresentationModel(pet("starter-wind", 1, "rare"))?.visualId, "starter-wind-r");
    assert.equal(petCloseupPresentationModel(pet("starter-wind", 2, "legendary")), null);
    assert.equal(petCloseupPresentationModel(pet("starter-fire", 0))?.visualId, "starter-fire");
});

test("every anatomy family gets a grounded, size-capped victory beat", () => {
    const heights = {
        quadruped: petVictoryArcHeight(2, "quadruped", false),
        biped: petVictoryArcHeight(2, "biped", false),
        avian: petVictoryArcHeight(2, "avian", false),
        serpentine: petVictoryArcHeight(2, "serpentine", false),
        heavy: petVictoryArcHeight(2, "heavy", false),
        aquatic: petVictoryArcHeight(2, "serpentine", true),
    };
    for (const height of Object.values(heights)) {
        assert.ok(height > 0);
        assert.ok(height <= 0.12);
    }
    assert.ok(heights.avian < heights.quadruped);
    assert.ok(heights.serpentine < heights.biped);
    assert.ok(heights.heavy < heights.quadruped);
    assert.equal(petVictoryArcHeight(20, "quadruped", false), 0.12);
});

test("all 160 production combat models inherit the grounded victory envelope", () => {
    const ids = [...PET_COMBAT_MODEL_IDS, ...APPROVED_ROSTER_MODEL_IDS];
    assert.equal(ids.length, 160);
    for (const id of ids) {
        const config = petCombatModel({ id, name: id });
        assert.ok(config, `${id} is missing its production model config`);
        const height = petVictoryArcHeight(config.targetHeight, config.profile, false);
        assert.ok(height > 0 && height <= 0.12, `${id} has an unsafe victory lift of ${height}`);
    }
});
