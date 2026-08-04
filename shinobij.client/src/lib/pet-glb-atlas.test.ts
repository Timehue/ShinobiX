import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import { extractEmbeddedPetAtlas } from "./pet-glb-atlas";

// The roster GLBs carry their baked colour atlas as WebP (EXT_texture_webp) after
// the meshopt/WebP re-encode — a WebP RIFF container: "RIFF" at [0,4) and "WEBP" at
// [8,12). Authored atlases run ~68–302 KB; a placeholder/solid texture would be a
// few KB, so a 40 KB floor certifies the real atlas is present without pinning the
// exact compressed size.
const WEBP_FOURCC = "RIFF";
const WEBP_FORMAT = "WEBP";
const MIN_AUTHORED_ATLAS_BYTES = 40_000;

function fourCC(bytes: Uint8Array, offset: number): string {
    return String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
}

function syntheticPbrGlb(): ArrayBuffer {
    const normal = new TextEncoder().encode("normal-map");
    const color = new TextEncoder().encode("base-color-map");
    const json = new TextEncoder().encode(JSON.stringify({
        asset: { version: "2.0" },
        bufferViews: [
            { buffer: 0, byteOffset: 0, byteLength: normal.byteLength },
            { buffer: 0, byteOffset: normal.byteLength, byteLength: color.byteLength },
        ],
        images: [
            { bufferView: 0, mimeType: "image/png" },
            { bufferView: 1, mimeType: "image/webp" },
        ],
        textures: [{ source: 0 }, { source: 1 }],
        materials: [{ pbrMetallicRoughness: { baseColorTexture: { index: 1 } } }],
    }));
    const paddedJsonLength = Math.ceil(json.byteLength / 4) * 4;
    const binLength = Math.ceil((normal.byteLength + color.byteLength) / 4) * 4;
    const totalLength = 12 + 8 + paddedJsonLength + 8 + binLength;
    const glb = new ArrayBuffer(totalLength);
    const view = new DataView(glb);
    view.setUint32(0, 0x46546c67, true);
    view.setUint32(4, 2, true);
    view.setUint32(8, totalLength, true);
    view.setUint32(12, paddedJsonLength, true);
    view.setUint32(16, 0x4e4f534a, true);
    new Uint8Array(glb, 20, paddedJsonLength).fill(0x20);
    new Uint8Array(glb, 20, json.byteLength).set(json);
    const binHeader = 20 + paddedJsonLength;
    view.setUint32(binHeader, binLength, true);
    view.setUint32(binHeader + 4, 0x004e4942, true);
    const bin = new Uint8Array(glb, binHeader + 8, binLength);
    bin.set(normal);
    bin.set(color, normal.byteLength);
    return glb;
}

async function atlasFromRosterModel(file: string) {
    const data = await readFile(new URL(`../../public/pet-models/roster/${file}`, import.meta.url));
    return extractEmbeddedPetAtlas(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer);
}

test("the exact live Oni Hound and Emberlynx models expose baked WebP colour atlases", async () => {
    const [oni, emberlynx] = await Promise.all([
        atlasFromRosterModel("mythic-4.glb"),
        atlasFromRosterModel("rare-26.glb"),
    ]);
    for (const atlas of [oni, emberlynx]) {
        assert.ok(atlas);
        assert.equal(atlas.mimeType, "image/webp");
        assert.equal(fourCC(atlas.bytes, 0), WEBP_FOURCC);
        assert.equal(fourCC(atlas.bytes, 8), WEBP_FORMAT);
        assert.ok(atlas.bytes.byteLength > MIN_AUTHORED_ATLAS_BYTES, "the full authored atlas should be present");
    }
    assert.notDeepEqual(oni?.bytes.subarray(0, 128), emberlynx?.bytes.subarray(0, 128));
});

test("malformed or non-GLB data is rejected without reading past its bounds", () => {
    assert.equal(extractEmbeddedPetAtlas(new ArrayBuffer(0)), null);
    assert.equal(extractEmbeddedPetAtlas(new TextEncoder().encode("not a glb").buffer), null);
});

test("the material base-colour binding wins over an earlier PBR normal map", () => {
    const atlas = extractEmbeddedPetAtlas(syntheticPbrGlb());
    assert.ok(atlas);
    assert.equal(atlas.mimeType, "image/webp");
    assert.equal(new TextDecoder().decode(atlas.bytes), "base-color-map");
});

test("every approved roster GLB contains a non-placeholder colour atlas", async () => {
    const rosterDir = new URL("../../public/pet-models/roster/", import.meta.url);
    const files = (await readdir(rosterDir)).filter((file) => file.endsWith(".glb")).sort();
    assert.equal(files.length, 145);
    const hashes = new Set<string>();
    for (const file of files) {
        const atlas = await atlasFromRosterModel(file);
        assert.ok(atlas, `${file} must contain an embedded atlas`);
        assert.equal(atlas.mimeType, "image/webp", `${file} must carry WebP colour data`);
        assert.equal(fourCC(atlas.bytes, 0), WEBP_FOURCC, `${file} must contain WebP colour data`);
        assert.equal(fourCC(atlas.bytes, 8), WEBP_FORMAT, `${file} must contain WebP colour data`);
        assert.ok(atlas.bytes.byteLength > MIN_AUTHORED_ATLAS_BYTES, `${file} must not use a tiny placeholder texture`);
        hashes.add(createHash("sha256").update(atlas.bytes).digest("hex"));
    }
    assert.ok(hashes.size >= 135, "the roster must not reuse a generic placeholder atlas");
});
