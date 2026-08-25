import assert from "node:assert/strict";
import test from "node:test";
import { rawPetPool } from "../data/pet-pool";
import { STARTER_EVOLUTIONS } from "../data/pet-evolutions";
import { STARTER_PETS } from "../data/starter-pets";
import { approvedRosterCombatModel } from "./pet-3d-roster";
import { petSignaturePerformance } from "./pet-signature-performance";

const catalog = [
    ...rawPetPool,
    ...STARTER_PETS.map((option) => option.pet),
    ...STARTER_EVOLUTIONS,
];

test("all 160 production pets receive stable, individually distinct performance direction", () => {
    assert.equal(catalog.length, 160);
    const signatures = catalog.map((pet) => {
        const profile = approvedRosterCombatModel(pet)?.profile
            ?? (pet.id.startsWith("starter-wind") ? "avian"
                : pet.id.startsWith("starter-water") ? "serpentine"
                    : pet.id.startsWith("starter-earth") ? "heavy"
                        : "quadruped");
        return petSignaturePerformance({
            id: pet.id,
            name: pet.name,
            element: pet.element,
            rarity: pet.rarity,
            profile,
        });
    });
    assert.equal(new Set(signatures.map((signature) => signature.key)).size, 160);
    assert.equal(new Set(signatures.map((signature) => signature.seed)).size, 160);
    assert.ok(signatures.every((signature) => signature.orbitCount >= 2 && signature.orbitCount <= 5));
    assert.ok(signatures.every((signature) => signature.impactRays >= 6 && signature.impactRays <= 9));
    assert.ok(signatures.every((signature) => signature.trailLanes >= 3 && signature.trailLanes <= 6));
});

test("signature direction is deterministic and respects species fantasy", () => {
    const kitsune = petSignaturePerformance({ id: "mythic-0", name: "Eclipse Kitsune", element: "Shadow", rarity: "mythic", profile: "quadruped" });
    const again = petSignaturePerformance({ id: "mythic-0", name: "Eclipse Kitsune", element: "Shadow", rarity: "mythic", profile: "quadruped" });
    const roc = petSignaturePerformance({ id: "legendary-21", name: "Storm Roc", element: "Wind", rarity: "legendary", profile: "avian" });
    const golem = petSignaturePerformance({ id: "legendary-27", name: "Titan Golem", element: "Earth", rarity: "legendary", profile: "heavy" });
    assert.deepEqual(kitsune, again);
    assert.equal(kitsune.entrance, "stalk");
    assert.equal(kitsune.motif, "fang");
    assert.equal(roc.entrance, "descent");
    assert.equal(roc.victory, "soar");
    assert.equal(golem.entrance, "quake");
    assert.equal(golem.victory, "monolith");
    assert.ok(golem.weight > roc.weight);
    assert.ok(roc.agility > golem.agility);
});

test("rarity raises spectacle without changing a pet's combat data", () => {
    const standard = petSignaturePerformance({ id: "standard-x", name: "Test Fox", element: "Fire", rarity: "standard", profile: "quadruped" });
    const mythic = petSignaturePerformance({ id: "standard-x", name: "Test Fox", element: "Fire", rarity: "mythic", profile: "quadruped" });
    assert.ok(mythic.aura > standard.aura);
    assert.ok(mythic.impactScale > standard.impactScale);
    assert.ok(mythic.projectileScale > standard.projectileScale);
    assert.equal(mythic.family, standard.family);
});
