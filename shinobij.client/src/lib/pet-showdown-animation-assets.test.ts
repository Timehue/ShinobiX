import { readFileSync } from "node:fs";
import { MeshoptDecoder } from "meshoptimizer";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { PET_RIG_REPAIR_REVISIONS } from "./pet-proper-animation-assets";
import {
    PET_SHOWDOWN_ANIMATION_ASSET_REVISION,
    PET_SHOWDOWN_ANIMATION_MODEL_IDS,
    petShowdownAnimationModelUrl,
} from "./pet-showdown-animation-assets.ts";

const EXPECTED_CLIPS = [
    "idle", "idle_2", "walk", "gallop", "gallop_jump", "attack", "idle_hitreact1", "death",
    "entrance", "cast", "guard", "rest", "victory",
];

function parseGlb(path: string) {
    const file = readFileSync(path);
    assert.equal(file.subarray(0, 4).toString("ascii"), "glTF");
    const jsonLength = file.readUInt32LE(12);
    const json = JSON.parse(file.subarray(20, 20 + jsonLength).toString("utf8").replace(/[\0\s]+$/u, ""));
    return { file, json };
}

// A repair appends identical binding streams after each asset's own animation
// bank. Accessor indices can differ while the actual reviewed mesh stays equal.
async function meshContent({ file, json }: ReturnType<typeof parseGlb>) {
    await MeshoptDecoder.ready;
    const meshes = structuredClone(json.meshes);
    if (!json.extras?.birdFaceRepair) return meshes;
    const binStart = 28 + file.readUInt32LE(12);
    for (const mesh of meshes) for (const primitive of mesh.primitives) {
        for (const name of ["JOINTS_0", "WEIGHTS_0"]) {
            const accessor = json.accessors[primitive.attributes[name]];
            const view = json.bufferViews[accessor.bufferView];
            assert.equal(accessor.type, "VEC4");
            assert.equal(view.byteStride, undefined);
            const componentBytes = accessor.componentType === 5123 ? 2 : accessor.componentType === 5126 ? 4 : 0;
            assert.ok(componentBytes, "unexpected repaired binding component type");
            const start = binStart + (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
            const compression = view.extensions?.EXT_meshopt_compression;
            const bytes = compression ? Buffer.alloc(view.byteLength) : file.subarray(start, start + accessor.count * 4 * componentBytes);
            if (compression) MeshoptDecoder.decodeGltfBuffer(bytes, compression.count, compression.byteStride,
                file.subarray(binStart + compression.byteOffset, binStart + compression.byteOffset + compression.byteLength), compression.mode);
            primitive.attributes[name] = {
                type: accessor.type, componentType: accessor.componentType, count: accessor.count,
                sha256: createHash("sha256").update(bytes).digest("hex"),
            };
        }
    }
    return meshes;
}

test("the screenshot lineup uses four versioned species-authored GLBs", () => {
    assert.deepEqual([...PET_SHOWDOWN_ANIMATION_MODEL_IDS].sort(), [
        "rare-1", "standard-7", "starter-fire-l", "starter-lightning-l",
    ]);
    for (const id of PET_SHOWDOWN_ANIMATION_MODEL_IDS) {
        assert.equal(
            petShowdownAnimationModelUrl(id),
            `/pet-models/showdown-v2/${id}.glb?v=${PET_RIG_REPAIR_REVISIONS[id] ?? PET_SHOWDOWN_ANIMATION_ASSET_REVISION}`,
        );
    }
    assert.notEqual(PET_RIG_REPAIR_REVISIONS["starter-lightning-l"], PET_SHOWDOWN_ANIMATION_ASSET_REVISION, "the repaired Hound must invalidate the previously cached face");
    assert.equal(petShowdownAnimationModelUrl("standard-8"), null);
});

test("each replacement preserves its reviewed model but carries a full identity performance bank", async () => {
    const fingerprints = new Set<string>();
    for (const id of PET_SHOWDOWN_ANIMATION_MODEL_IDS) {
        const sourcePath = id.startsWith("starter-")
            ? resolve(import.meta.dirname, `../../public/pet-models/${id}.glb`)
            : resolve(import.meta.dirname, `../../public/pet-models/roster/${id}.glb`);
        const authoredPath = resolve(import.meta.dirname, `../../public/pet-models/showdown-v2/${id}.glb`);
        const source = parseGlb(sourcePath);
        const authored = parseGlb(authoredPath);

        assert.deepEqual(await meshContent(authored), await meshContent(source), `${id}: mesh changed during animation authoring`);
        assert.deepEqual(authored.json.materials, source.json.materials, `${id}: materials changed during animation authoring`);
        assert.deepEqual(authored.json.skins, source.json.skins, `${id}: reviewed skin changed during animation authoring`);
        assert.equal(authored.json.extras?.showdownAnimationBank, PET_SHOWDOWN_ANIMATION_ASSET_REVISION);
        assert.equal(authored.json.extras?.animationAuthoring, "bespoke-species-performance-v3");
        assert.equal(authored.json.extras?.showdownAnimationIdentity?.key, id);
        assert.equal(typeof authored.json.extras?.showdownAnimationIdentity?.style, "string");
        assert.match(authored.json.extras?.showdownAnimationIdentity?.fingerprint, /^[A-F0-9]{24}$/u);
        fingerprints.add(authored.json.extras.showdownAnimationIdentity.fingerprint);
        assert.match(authored.json.asset?.generator ?? "", new RegExp(id));
        assert.deepEqual(authored.json.animations.map((animation: { name: string }) => animation.name), EXPECTED_CLIPS);
        for (const animation of authored.json.animations) {
            assert.ok(animation.channels.length >= 4, `${id}/${animation.name}: performance is too sparse`);
            assert.ok(animation.channels.length <= 8, `${id}/${animation.name}: inherited generic all-bone take detected`);
            assert.equal(animation.channels.length, animation.samplers.length);
        }
        assert.ok(authored.file.byteLength > 300_000, `${id}: output is unexpectedly truncated`);
    }
    assert.equal(fingerprints.size, 4, "every showcase pet needs a distinct performance fingerprint");
});
