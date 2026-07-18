import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import { extractEmbeddedPetAtlas } from "./pet-glb-atlas";

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

async function atlasFromRosterModel(file: string) {
    const data = await readFile(new URL(`../../public/pet-models/roster/${file}`, import.meta.url));
    return extractEmbeddedPetAtlas(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer);
}

test("the exact live Oni Hound and Emberlynx models expose baked PNG colour atlases", async () => {
    const [oni, emberlynx] = await Promise.all([
        atlasFromRosterModel("mythic-4.glb"),
        atlasFromRosterModel("rare-26.glb"),
    ]);
    for (const atlas of [oni, emberlynx]) {
        assert.ok(atlas);
        assert.equal(atlas.mimeType, "image/png");
        assert.deepEqual([...atlas.bytes.subarray(0, PNG_SIGNATURE.length)], PNG_SIGNATURE);
        assert.ok(atlas.bytes.byteLength > 1_000_000, "the full authored atlas should be present");
    }
    assert.notDeepEqual(oni?.bytes.subarray(0, 128), emberlynx?.bytes.subarray(0, 128));
});

test("malformed or non-GLB data is rejected without reading past its bounds", () => {
    assert.equal(extractEmbeddedPetAtlas(new ArrayBuffer(0)), null);
    assert.equal(extractEmbeddedPetAtlas(new TextEncoder().encode("not a glb").buffer), null);
});

test("every approved roster GLB contains a non-placeholder colour atlas", async () => {
    const rosterDir = new URL("../../public/pet-models/roster/", import.meta.url);
    const files = (await readdir(rosterDir)).filter((file) => file.endsWith(".glb")).sort();
    assert.equal(files.length, 140);
    const hashes = new Set<string>();
    for (const file of files) {
        const atlas = await atlasFromRosterModel(file);
        assert.ok(atlas, `${file} must contain an embedded atlas`);
        assert.deepEqual([...atlas.bytes.subarray(0, PNG_SIGNATURE.length)], PNG_SIGNATURE, `${file} must contain PNG colour data`);
        assert.ok(atlas.bytes.byteLength > 250_000, `${file} must not use a tiny placeholder texture`);
        hashes.add(createHash("sha256").update(atlas.bytes).digest("hex"));
    }
    assert.ok(hashes.size >= 135, "the roster must not reuse a generic placeholder atlas");
});
