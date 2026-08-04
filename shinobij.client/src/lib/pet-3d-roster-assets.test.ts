import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { APPROVED_ROSTER_MODEL_IDS } from "./pet-3d-roster";

interface GltfPrimitive {
    attributes?: Record<string, number>;
    material?: number;
}

interface GltfDocument {
    animations?: unknown[];
    images?: Array<{ bufferView?: number; uri?: string }>;
    materials?: Array<{ pbrMetallicRoughness?: { baseColorTexture?: { index: number } } }>;
    meshes?: Array<{ primitives?: GltfPrimitive[] }>;
    nodes?: Array<{ mesh?: number }>;
    skins?: unknown[];
    textures?: unknown[];
}

interface ManifestEntry {
    approved?: boolean;
    sha256?: string;
    status?: string;
    textured?: boolean;
}

interface RosterManifest {
    entries: Record<string, ManifestEntry>;
}

const clientRoot = resolve(import.meta.dirname, "../..");
const rosterDirectory = resolve(clientRoot, "public/pet-models/roster");
const manifest = JSON.parse(
    readFileSync(resolve(clientRoot, "public/pet-models/roster-manifest.json"), "utf8"),
) as RosterManifest;

function parseGlb(file: Buffer): GltfDocument {
    assert.equal(file.subarray(0, 4).toString("ascii"), "glTF", "missing GLB magic");
    assert.equal(file.readUInt32LE(4), 2, "production model must use GLB v2");
    assert.equal(file.readUInt32LE(8), file.byteLength, "GLB header length does not match the asset");
    const jsonLength = file.readUInt32LE(12);
    assert.equal(file.readUInt32LE(16), 0x4e4f534a, "first GLB chunk must be JSON");
    return JSON.parse(file.subarray(20, 20 + jsonLength).toString("utf8").replace(/[\0\s]+$/, "")) as GltfDocument;
}

test("all approved roster models are colored, skinned, animated single-pet assets", () => {
    const modelFiles = readdirSync(rosterDirectory).filter((file) => file.endsWith(".glb")).sort();
    const modelIds = modelFiles.map((file) => file.slice(0, -4));
    assert.equal(modelIds.length, 145, "the complete production roster must be present");
    assert.deepEqual(modelIds, [...APPROVED_ROSTER_MODEL_IDS].sort(), "disk assets and the approval list must match");
    assert.deepEqual(Object.keys(manifest.entries).sort(), modelIds, "manifest and production assets must match");

    for (const id of modelIds) {
        const file = readFileSync(resolve(rosterDirectory, `${id}.glb`));
        const entry = manifest.entries[id];
        assert.equal(entry.approved, true, `${id}: manifest approval missing`);
        assert.equal(entry.status, "approved_rigged", `${id}: asset is not a production rig`);
        assert.equal(entry.textured, true, `${id}: manifest does not certify its color atlas`);
        assert.equal(createHash("sha256").update(file).digest("hex").toUpperCase(), entry.sha256, `${id}: asset differs from the reviewed binary`);

        const gltf = parseGlb(file);
        assert.equal(gltf.meshes?.length, 1, `${id}: multiple meshes can indicate an untrimmed reconstruction`);
        assert.equal(gltf.nodes?.filter((node) => Number.isInteger(node.mesh)).length, 1, `${id}: model must contain one visible pet mesh`);
        assert.equal(gltf.skins?.length, 1, `${id}: model is missing its production skeleton`);
        assert.equal(gltf.animations?.length, 8, `${id}: model is missing its reviewed animation set`);
        assert.ok((gltf.images?.length ?? 0) >= 1, `${id}: embedded color atlas is missing`);
        assert.ok(gltf.images?.every((image) => Number.isInteger(image.bufferView) || image.uri?.startsWith("data:")), `${id}: all authored textures must be embedded`);
        assert.ok((gltf.textures?.length ?? 0) >= 1, `${id}: texture binding is missing`);
        assert.equal(gltf.materials?.length, 1, `${id}: model must use its single reviewed production material`);

        const primitive = gltf.meshes[0]?.primitives?.[0];
        assert.equal(gltf.meshes[0]?.primitives?.length, 1, `${id}: unexpected loose mesh islands were exported`);
        assert.ok(Number.isInteger(primitive?.material), `${id}: visible mesh has no material`);
        assert.ok(Number.isInteger(gltf.materials[primitive!.material!]?.pbrMetallicRoughness?.baseColorTexture?.index), `${id}: visible mesh is not connected to its color atlas`);
        for (const attribute of ["POSITION", "NORMAL", "TEXCOORD_0", "JOINTS_0", "WEIGHTS_0"]) {
            assert.ok(Number.isInteger(primitive?.attributes?.[attribute]), `${id}: missing ${attribute}`);
        }

    }
});
