import assert from "node:assert/strict";
import test from "node:test";
import type { PetCombatModelConfig } from "./pet-3d-models";
import {
    warfrontPetLodEnabled,
    warfrontPetLodEntry,
    warfrontPetModelConfig,
    warfrontPetModelSourceUrl,
} from "./pet-warfront-model-lod";

const source: PetCombatModelConfig = {
    visualId: "mythic-3",
    url: "/pet-models/roster/mythic-3.glb?v=source-revision",
    profile: "quadruped",
    targetHeight: 2.35,
    fit: "height",
    yawOffset: 0,
    outlineScale: 1,
};

test("Warfront maps a revisioned authored source to its certified battle LOD", () => {
    assert.equal(warfrontPetModelSourceUrl(source.url), "/pet-models/roster/mythic-3.glb");
    assert.deepEqual(warfrontPetLodEntry(source.url), {
        lodUrl: "/pet-models/warfront-lod/roster/mythic-3.glb?v=20260902-battle-lod-v1",
        sourceTriangles: 40_000,
        lodTriangles: 10_000,
    });
    const selected = warfrontPetModelConfig(source, true);
    assert.notEqual(selected, source);
    assert.equal(selected?.url, "/pet-models/warfront-lod/roster/mythic-3.glb?v=20260902-battle-lod-v1");
    assert.equal(source.url, "/pet-models/roster/mythic-3.glb?v=source-revision");
});

test("source A/B and unknown assets retain the authored model", () => {
    assert.equal(warfrontPetLodEnabled("?ritelod=0"), false);
    assert.equal(warfrontPetLodEnabled("?ritelod=1"), true);
    assert.equal(warfrontPetModelConfig(source, false), source);
    const unknown = { ...source, url: "/pet-models/future-pet.glb?v=1" };
    assert.equal(warfrontPetModelConfig(unknown, true), unknown);
    assert.equal(warfrontPetModelConfig(null, true), null);
});
