import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { rawPetPool } from "../data/pet-pool.ts";
import { STARTER_PETS } from "../data/starter-pets.ts";
import { STARTER_EVOLUTIONS } from "../data/pet-evolutions.ts";
import {
    INDIVIDUAL_PET_ANIMATION_MODEL_IDS,
    PROPER_PET_ANIMATION_ASSET_REVISION,
} from "./pet-proper-animation-assets.ts";
import { PET_SHOWDOWN_ANIMATION_ASSET_REVISION } from "./pet-showdown-animation-assets.ts";

const EXPECTED_CLIPS = [
    "idle", "idle_2", "walk", "gallop", "gallop_jump", "attack", "idle_hitreact1", "death",
];
const catalog = [
    ...rawPetPool,
    ...STARTER_PETS.map((option) => option.pet),
    ...STARTER_EVOLUTIONS,
];

function parseGlb(path: string) {
    const file = readFileSync(path);
    assert.equal(file.subarray(0, 4).toString("ascii"), "glTF", `${path}: missing GLB magic`);
    assert.equal(file.readUInt32LE(8), file.byteLength, `${path}: GLB length mismatch`);
    const jsonLength = file.readUInt32LE(12);
    return JSON.parse(file.subarray(20, 20 + jsonLength).toString("utf8").replace(/[\0\s]+$/u, ""));
}

test("all 160 production pets have complete proper skeletal animation banks", () => {
    assert.equal(catalog.length, 160);
    assert.equal(new Set(catalog.map((pet) => pet.id)).size, 160);
    const families = new Set<string>();
    const rigs = new Set<string>();
    let individual = 0;
    let familyAuthored = 0;

    for (const pet of catalog) {
        const individuallyAuthored = INDIVIDUAL_PET_ANIMATION_MODEL_IDS.has(pet.id);
        const path = individuallyAuthored
            ? resolve(import.meta.dirname, `../../public/pet-models/showdown-v2/${pet.id}.glb`)
            : pet.id.startsWith("starter-")
                ? resolve(import.meta.dirname, `../../public/pet-models/${pet.id}.glb`)
                : resolve(import.meta.dirname, `../../public/pet-models/roster/${pet.id}.glb`);
        const json = parseGlb(path);
        assert.deepEqual(json.animations?.map((animation: { name: string }) => animation.name), EXPECTED_CLIPS, `${pet.id}: incomplete clip set`);

        if (individuallyAuthored) {
            individual += 1;
            assert.equal(json.extras?.showdownAnimationBank, PET_SHOWDOWN_ANIMATION_ASSET_REVISION);
        } else {
            familyAuthored += 1;
            assert.equal(json.extras?.properAnimationBank, PROPER_PET_ANIMATION_ASSET_REVISION, `${pet.id}: stale animation revision`);
            assert.equal(typeof json.extras?.properAnimationFamily, "string");
            assert.equal(typeof json.extras?.properAnimationRig, "string");
            families.add(json.extras.properAnimationFamily);
            rigs.add(json.extras.properAnimationRig);
        }

        for (const animation of json.animations) {
            assert.ok(animation.channels.length >= 4, `${pet.id}/${animation.name}: take is too sparse`);
            assert.ok(animation.channels.length <= 9, `${pet.id}/${animation.name}: inherited generic all-bone take detected`);
            assert.equal(animation.channels.length, animation.samplers.length);
            for (const sampler of animation.samplers) {
                const input = json.accessors[sampler.input];
                assert.ok(input.min?.[0] === 0 && input.max?.[0] > 0, `${pet.id}/${animation.name}: invalid timeline`);
            }
        }
        const death = json.animations.find((animation: { name: string }) => animation.name === "death");
        assert.ok(death.channels.some((channel: { target: { node: number; path: string } }) => json.nodes[channel.target.node]?.name === "root" && channel.target.path === "translation"), `${pet.id}: death has no grounded root collapse`);
    }

    assert.equal(individual, 4);
    assert.equal(familyAuthored, 156);
    assert.ok(families.size >= 12, "family coverage collapsed into too few motion styles");
    assert.deepEqual([...rigs].sort(), ["avian", "bat", "biped", "crab", "insect", "moth", "quadruped"]);
});
