import { readFileSync } from "node:fs";
import { Vector3 } from 'three';
import {loadPetDeformationProbe} from '../../scripts/lib/pet-deformation-probe.mjs';
import {petMeshContent} from '../../scripts/lib/pet-mesh-content.mjs';
import { resolve } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { PET_RIG_REPAIR_REVISIONS, PET_CHARACTER_MOTION_ASSET_REVISION } from "./pet-proper-animation-assets";
import {
    PET_SHOWDOWN_ANIMATION_ASSET_REVISION,
    PET_SHOWDOWN_ANIMATION_MODEL_IDS,
    petShowdownAnimationModelUrl,
    petShowdownAnimationYawOffset,
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
    return { file, json, path };
}

// Compare resolved live data: accessor IDs legitimately change on compaction.
const models=new Map();
async function modelFor(asset:ReturnType<typeof parseGlb>){
    if(!models.has(asset.path))models.set(asset.path,loadPetDeformationProbe(asset.path));
    return models.get(asset.path);
}
async function meshContent({ file }: ReturnType<typeof parseGlb>, repairedBindings = false) {
    return petMeshContent(file,repairedBindings);
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
    assert.equal(petShowdownAnimationYawOffset("starter-lightning-l"), 0, "the replacement sculpt already faces combat +Z");
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

        const repairedBindings = !!authored.json.extras?.skinSeamRepair;
        assert.deepEqual(await meshContent(authored, repairedBindings), await meshContent(source, repairedBindings), `${id}: reviewed topology/UV/normals changed during animation authoring`);
        if (repairedBindings) assert.match(authored.json.extras.skinSeamRepair.sourceSha256, /^[a-f0-9]{64}$/);
        assert.deepEqual(authored.json.materials, source.json.materials, `${id}: materials changed during animation authoring`);
        const [originalModel,currentModel]=await Promise.all([modelFor(source),modelFor(authored)]);
        assert.deepEqual(authored.json.skins[0].joints,source.json.skins[0].joints,`${id}: joint hierarchy changed`);
        if(authored.json.extras.reviewedRigScaleRepair){
            const before=originalModel.meshes[0],after=currentModel.meshes[0];
            assert.equal(before.geometry.attributes.position.count,after.geometry.attributes.position.count);
            for(let vertex=0;vertex<before.geometry.attributes.position.count;vertex++)assert.ok(before.getVertexPosition(vertex,new Vector3()).applyMatrix4(before.matrixWorld).distanceTo(after.getVertexPosition(vertex,new Vector3()).applyMatrix4(after.matrixWorld))<1e-5,`${id}: normalized rig changed bind appearance`);
        }else assert.deepEqual(currentModel.meshes[0].skeleton.boneInverses.map((m:{elements:number[]})=>m.elements),originalModel.meshes[0].skeleton.boneInverses.map((m:{elements:number[]})=>m.elements),`${id}: inverse binds changed`);
        assert.equal(authored.json.extras?.showdownAnimationBank, PET_SHOWDOWN_ANIMATION_ASSET_REVISION);
        assert.equal(authored.json.extras?.animationAuthoring, "bespoke-species-performance-v3");
        assert.equal(authored.json.extras?.showdownAnimationIdentity?.key, id);
        assert.equal(typeof authored.json.extras?.showdownAnimationIdentity?.style, "string");
        assert.match(authored.json.extras?.showdownAnimationIdentity?.fingerprint, /^[A-F0-9]{24}$/u);
        fingerprints.add(authored.json.extras.showdownAnimationIdentity.fingerprint);
        assert.match(authored.json.asset?.generator ?? "", new RegExp(id));
        assert.deepEqual(authored.json.animations.map((animation: { name: string }) => animation.name), EXPECTED_CLIPS);
        if (id === "starter-lightning-l") {
            assert.equal(authored.json.extras?.showdownAnimationArtPass, "20260923-raijin-articulated-v1");
            assert.ok(authored.json.animations.some((animation: { channels: unknown[] }) => animation.channels.length > 8), "Raijin's polished pass must articulate more than the original blockout");
        }
        for (const [index, animation] of authored.json.animations.entries()) {
            assert.ok(animation.channels.length >= 4, `${id}/${animation.name}: performance is too sparse`);
            const originalCount = authored.json.extras.performanceRefinement.sourceBoundary.channels[index];
            assert.ok(originalCount <= (id === "starter-lightning-l" ? 16 : 8), `${id}/${animation.name}: original identity performance must stay focused`);
            assert.equal(authored.json.extras.characterMotion?.revision, PET_CHARACTER_MOTION_ASSET_REVISION);
            assert.ok(animation.channels.length <= authored.json.skins[0].joints.length + 1, `${id}/${animation.name}: bank exceeds the measured skeleton's channel budget`);
            assert.equal(new Set(animation.channels.map((channel: { target: { node: number; path: string } }) => `${channel.target.node}:${channel.target.path}`)).size, animation.channels.length, 'joint tracks cannot compete');
            assert.equal(animation.channels.length, animation.samplers.length);
        }
        assert.ok(authored.file.byteLength > 300_000, `${id}: output is unexpectedly truncated`);
    }
    assert.equal(fingerprints.size, 4, "every showcase pet needs a distinct performance fingerprint");
});
