import assert from "node:assert/strict";
import test from "node:test";
import { EVOLUTION_LINES } from "../data/pet-evolutions";
import { rawPetPool } from "../data/pet-pool";
import { STARTER_PETS } from "../data/starter-pets";
import { approvedRosterCombatModel } from "./pet-3d-roster";
import { petCombatFamily, petCombatFamilyPresentation } from "./pet-combat-family";
import { petHeroMoveStyle } from "./pet-hero-moves";

test("petCombatFamily separates species behavior from locomotion skeleton", () => {
    assert.equal(petCombatFamily({ name: "Young Direwolf", profile: "quadruped" }), "pack-hunter");
    assert.equal(petCombatFamily({ name: "Ember Ocelot", profile: "quadruped" }), "pouncer");
    assert.equal(petCombatFamily({ name: "Thorn Stag", profile: "quadruped" }), "charger");
    assert.equal(petCombatFamily({ name: "Terra Porcupine", profile: "heavy" }), "burrow-grappler");
    assert.equal(petCombatFamily({ name: "Ironback Turtle", profile: "heavy" }), "armored");
    assert.equal(petCombatFamily({ name: "Tidal Selkie", profile: "serpentine" }), "amphibious");
});

test("petCombatFamily uses approved model profile as a stable fantasy fallback", () => {
    assert.equal(petCombatFamily({ name: "Storm Roc", profile: "avian" }), "avian");
    assert.equal(petCombatFamily({ name: "Worldstorm Dragon", profile: "serpentine" }), "dragon");
    assert.equal(petCombatFamily({ name: "Unknown Titan", profile: "heavy" }), "armored");
    assert.equal(petCombatFamily({ name: "Unknown Ninja", profile: "biped" }), "skirmisher");
});

test("all 145 approved roster pets have explicit animal combat language", () => {
    assert.equal(rawPetPool.length, 145);
    for (const pet of rawPetPool) {
        const model = approvedRosterCombatModel(pet);
        assert.ok(model, `${pet.id} ${pet.name} is missing an approved combat model`);
        const family = petCombatFamily({ name: pet.name, profile: model.profile });
        assert.notEqual(family, "skirmisher", `${pet.id} ${pet.name} fell through to the generic family`);
        const presentation = petCombatFamilyPresentation({ name: pet.name, profile: model.profile });
        assert.ok(presentation.label && presentation.tell && presentation.motif, `${pet.id} ${pet.name} has incomplete broadcast identity`);
        const style = petHeroMoveStyle({ petId: pet.id, petName: pet.name, profile: model.profile });
        assert.notEqual(style, "generic", `${pet.id} ${pet.name} fell through to the generic move style`);
    }
});

test("all 15 starter forms retain species-specific combat language", () => {
    for (const option of STARTER_PETS) {
        const line = EVOLUTION_LINES[option.pet.id];
        const forms = [
            option.pet,
            { ...option.pet, name: line.stages[1].name, rarity: line.stages[1].rarity, evolutionStage: 1 as const },
            { ...option.pet, name: line.stages[2].name, rarity: line.stages[2].rarity, evolutionStage: 2 as const },
        ];
        for (const pet of forms) {
            const model = approvedRosterCombatModel(pet) ?? { profile: pet.id === "starter-wind" ? "avian" as const : pet.id === "starter-water" ? "serpentine" as const : pet.id === "starter-earth" ? "heavy" as const : "quadruped" as const };
            assert.notEqual(petCombatFamily({ name: pet.name, profile: model.profile }), "skirmisher", `${pet.name} has generic family`);
            assert.notEqual(petHeroMoveStyle({ petId: pet.id, petName: pet.name, profile: model.profile }), "generic", `${pet.name} has generic style`);
        }
    }
});

test("family presentation exposes a short broadcast-readable tell", () => {
    assert.deepEqual(petCombatFamilyPresentation({ name: "Solar Stag", profile: "quadruped" }), {
        family: "charger",
        label: "Charger",
        tell: "display · brace · drive",
        motif: "➤",
    });
});
