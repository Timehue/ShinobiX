import test from "node:test";
import assert from "node:assert/strict";
import { WARFRONT_IMPOSTOR_MANIFEST } from "../generated/pet-warfront-impostor-manifest";
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
        assert.equal(warfrontImpostorAtlasUrl(`${source}?v=approved`), entry.atlasUrl);
    }
    assert.equal(warfrontImpostorAtlasUrl("/external/not-approved.glb"), null);
});
