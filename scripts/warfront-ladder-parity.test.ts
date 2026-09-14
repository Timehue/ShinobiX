import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { defaultWarfrontLadderPlan, WARFRONT_LADDER_DEPLOYMENT } from "../shared/warfront-ladder-plan.js";
import { runWarfrontRite, WARFRONT_DEFAULT_DEPLOYMENT } from "../shinobij.client/src/lib/pet-warfront-rite.js";
import { toClientPet, toClientWarfrontSlot } from "../shinobij.client/src/lib/pet-ladder-client.js";
import { petCombatModel } from "../shinobij.client/src/lib/pet-3d-models.js";
import { petPaletteVariant } from "../shinobij.client/src/lib/pet-visual-variant.js";
import { AI_TACTICAL, ladderRoles, ladderWarfrontPlan, resolveLadderWarfront, snapshotLadderPet, toPet, type DefenseDoc } from "../api/pet-ladder/_core.js";

const defense = (index: number): DefenseDoc => {
    const team = AI_TACTICAL[index];
    return { slug: `test-${index}`, name: team.name, mode: "tactical", pets: team.pets, roles: ladderRoles(team.pets), updatedAt: 1 };
};

test("pre-migration defenses preserve their roster and gain the same visible legal formation", () => {
    const saved = defense(0);
    const before = JSON.stringify(saved);
    assert.deepEqual(ladderWarfrontPlan(saved), defaultWarfrontLadderPlan());
    assert.deepEqual(WARFRONT_LADDER_DEPLOYMENT, WARFRONT_DEFAULT_DEPLOYMENT);
    assert.equal(JSON.stringify(saved), before);
});

test("ranked Warfront server verdict and client replay agree on sealed positions and trained stats", () => {
    const blue = defense(0), red = defense(1);
    // Migrated defenses stored some roles only on the team slot. Deliberately
    // choose different ones from template derivation to catch replay drift.
    blue.pets = blue.pets.map((pet) => ({ ...pet, role: undefined }));
    blue.roles = ["sage", "assassin", "defender", "tracker"];
    blue.warfrontPlan = { ...defaultWarfrontLadderPlan(), deployment: [1, 2, 9, 6] };
    red.warfrontPlan = { ...defaultWarfrontLadderPlan(), deployment: [8, 5, 0, 3] };
    const server = resolveLadderWarfront(blue, red, 1297);
    const replay = runWarfrontRite(
        blue.pets.map((pet, slot) => toClientWarfrontSlot({ pet, role: blue.roles[slot] }).pet),
        red.pets.map((pet, slot) => toClientWarfrontSlot({ pet, role: red.roles[slot] }).pet),
        1297, server.bluePlan, server.redPlan,
    );
    assert.deepEqual(replay, server);
    assert.deepEqual(server.clashes[0].blue.map((pet) => pet.node), blue.warfrontPlan.deployment);
    assert.deepEqual(server.clashes[0].red.map((pet) => pet.node), red.warfrontPlan.deployment);
    assert.ok(server.clashes.length >= 2 && server.clashes.length <= 3);
    for (const clash of server.clashes) {
        assert.deepEqual(clash.blue.map((pet) => pet.node), blue.warfrontPlan.deployment);
        assert.deepEqual(clash.red.map((pet) => pet.node), red.warfrontPlan.deployment);
    }
});

test("ranked snapshots preserve valid subroles and trained combat stats through both reconstructions", () => {
    const snapshot = snapshotLadderPet({ ...AI_TACTICAL[0].pets[0], subRole: "bruiser", level: 38, hp: 890, attack: 122, defense: 86, speed: 112 });
    for (const pet of [toPet(snapshot), toClientPet(snapshot)]) {
        assert.equal(pet.subRole, "bruiser");
        assert.deepEqual([pet.level, pet.hp, pet.attack, pet.defense, pet.speed], [38, 890, 122, 86, 112]);
    }
    assert.equal(snapshotLadderPet({ ...snapshot, subRole: "forged" }).subRole, undefined);
});

test("renamed instance pets retain evolved model and chromatic identity through the sealed ladder replay", () => {
    const snapshot = snapshotLadderPet({
        ...AI_TACTICAL[0].pets[1], id: "ec90a-instance-pet", name: "My Renamed Companion",
        templateId: "starter-wind", evolutionStage: 1, paletteVariantId: "chromatic",
    });
    for (const pet of [toPet(snapshot), toClientPet(snapshot)]) {
        assert.equal(pet.templateId, "starter-wind");
        assert.equal(pet.evolutionStage, 1);
        assert.equal(petCombatModel(pet)?.visualId, "starter-wind-r");
        assert.equal(petPaletteVariant(pet), "chromatic");
    }
    const bounded = snapshotLadderPet({ ...snapshot, templateId: "x".repeat(1000), evolutionStage: 99, paletteVariantId: "y".repeat(1000) });
    assert.equal(bounded.templateId?.length, 80);
    assert.equal(bounded.paletteVariantId?.length, 40);
    assert.equal(bounded.evolutionStage, undefined);
});

test("all ranked AI companions resolve a canonical combat model and carry modest equipped moves", () => {
    for (const team of AI_TACTICAL) {
        assert.equal(new Set(team.pets.map((pet) => pet.id)).size, 4);
        for (const pet of team.pets) {
            assert.ok(petCombatModel(toClientPet(pet)), `${pet.name} must have a model`);
            assert.ok(pet.jutsus.some((jutsu) => jutsu.kind === "damage"));
            assert.ok(pet.jutsus.length >= 2 && pet.jutsus.every((jutsu) => jutsu.power <= 50));
        }
    }
});

test("ranked entry points and API have no executable legacy lane battle path", () => {
    const core = readFileSync(new URL("../api/pet-ladder/_core.ts", import.meta.url), "utf8");
    const handler = readFileSync(new URL("../api/pet-ladder/ladder.ts", import.meta.url), "utf8");
    const client = readFileSync(new URL("../shinobij.client/src/screens/PetLadder.tsx", import.meta.url), "utf8");
    assert.doesNotMatch(core, /import .*runWarfrontMatch/);
    assert.match(handler, /kind: 'warfront'/);
    assert.match(client, /const sealedReplay = useMemo\(\(\) => \(\{ bluePlan: replay.bluePlan, redPlan: replay.redPlan \}\), \[replay\]\)/);
    assert.match(client, /sealedReplay=\{sealedReplay\}/);
    assert.doesNotMatch(client, /import\("\.\.\/components\/PetWarfrontMatch"\)|War Council|Pet Tactical/);
});
