import test from "node:test";
import assert from "node:assert/strict";
import { petCombatModel } from "./pet-3d-models";
import { rawPetPool } from "../data/pet-pool";
import { STARTER_PETS } from "../data/starter-pets";
import { STARTER_EVOLUTIONS } from "../data/pet-evolutions";
import { WARFRONT_IMPOSTOR_MANIFEST } from "../generated/pet-warfront-impostor-manifest";
import { WARFRONT_IMPOSTOR_ATLAS_REVISIONS } from "../generated/pet-warfront-impostor-url-manifest";
import { warfrontImpostorEntry } from "./pet-warfront-impostor";
import { warfrontImpostorAtlasUrl } from "./pet-warfront-impostor-url";

test("software impostors resolve revisioned exact-model URLs", () => {
    const entry = warfrontImpostorEntry("https://example.invalid/pet-models/roster/mythic-0.glb?v=authored");
    assert.equal(entry?.atlasUrl, "/pet-models/warfront-impostors/roster/mythic-0.webp");
    assert.equal(entry?.frames.length, 16);
    assert.deepEqual(entry?.frames[8], { clip: "attack", progress: 0.2 });
});

test("an uncertified source stays on the skinned fallback", () => {
    assert.equal(warfrontImpostorEntry("/pet-models/roster/not-generated.glb"), null);
});

test("the lightweight runtime derivation matches every generated atlas URL", () => {
    for (const [source, entry] of Object.entries(WARFRONT_IMPOSTOR_MANIFEST)) {
        const expected = `${entry.atlasUrl}?v=${WARFRONT_IMPOSTOR_ATLAS_REVISIONS[source as keyof typeof WARFRONT_IMPOSTOR_ATLAS_REVISIONS]}`;
        assert.equal(warfrontImpostorAtlasUrl(source), expected);
        assert.equal(warfrontImpostorAtlasUrl(`${source}?v=approved`), expected);
    }
    assert.equal(warfrontImpostorAtlasUrl("/external/not-approved.glb"), null);
});

test("every production pet keeps a generated atlas when software rendering is selected", () => {
    const entries = new Map(Object.entries(WARFRONT_IMPOSTOR_MANIFEST));
    for (const pet of [...rawPetPool, ...STARTER_PETS.map(option => option.pet), ...STARTER_EVOLUTIONS]) {
        const source = petCombatModel(pet)?.url;
        assert.ok(source, `${pet.id}: approved combat model missing`);
        const sourcePath = new URL(source, "https://local.invalid").pathname;
        const atlas = entries.get(sourcePath);
        assert.ok(atlas, `${pet.id}: generated software atlas missing`);
        assert.equal(warfrontImpostorAtlasUrl(source)?.split("?", 1)[0], atlas.atlasUrl);
    }
});

test("the repaired Hound invalidates its fallback atlas with the baked image", () => {
    const hound = petCombatModel({ id: "starter-lightning", rarity: "legendary", evolutionStage: 2 })!;
    assert.equal(warfrontImpostorAtlasUrl(hound.url), `/pet-models/warfront-impostors/showdown-v2/starter-lightning-l.webp?v=${WARFRONT_IMPOSTOR_ATLAS_REVISIONS["/pet-models/showdown-v2/starter-lightning-l.glb"]}`);
});
