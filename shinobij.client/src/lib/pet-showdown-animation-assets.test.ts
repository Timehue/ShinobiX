import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import {
    PET_SHOWDOWN_ANIMATION_ASSET_REVISION,
    PET_SHOWDOWN_ANIMATION_MODEL_IDS,
    petShowdownAnimationModelUrl,
} from "./pet-showdown-animation-assets.ts";

const EXPECTED_CLIPS = [
    "idle", "idle_2", "walk", "gallop", "gallop_jump", "attack", "idle_hitreact1", "death",
];

function parseGlb(path: string) {
    const file = readFileSync(path);
    assert.equal(file.subarray(0, 4).toString("ascii"), "glTF");
    const jsonLength = file.readUInt32LE(12);
    const json = JSON.parse(file.subarray(20, 20 + jsonLength).toString("utf8").replace(/[\0\s]+$/u, ""));
    return { file, json };
}

test("the screenshot lineup uses four versioned species-authored GLBs", () => {
    assert.deepEqual([...PET_SHOWDOWN_ANIMATION_MODEL_IDS].sort(), [
        "rare-1", "standard-7", "starter-fire-l", "starter-lightning-l",
    ]);
    for (const id of PET_SHOWDOWN_ANIMATION_MODEL_IDS) {
        assert.equal(
            petShowdownAnimationModelUrl(id),
            `/pet-models/showdown-v2/${id}.glb?v=${PET_SHOWDOWN_ANIMATION_ASSET_REVISION}`,
        );
    }
    assert.equal(petShowdownAnimationModelUrl("standard-8"), null);
});

test("each replacement preserves its reviewed model but carries a new complete animation bank", () => {
    for (const id of PET_SHOWDOWN_ANIMATION_MODEL_IDS) {
        const sourcePath = id.startsWith("starter-")
            ? resolve(import.meta.dirname, `../../public/pet-models/${id}.glb`)
            : resolve(import.meta.dirname, `../../public/pet-models/roster/${id}.glb`);
        const authoredPath = resolve(import.meta.dirname, `../../public/pet-models/showdown-v2/${id}.glb`);
        const source = parseGlb(sourcePath);
        const authored = parseGlb(authoredPath);

        assert.deepEqual(authored.json.meshes, source.json.meshes, `${id}: mesh changed during animation authoring`);
        assert.deepEqual(authored.json.materials, source.json.materials, `${id}: materials changed during animation authoring`);
        assert.deepEqual(authored.json.skins, source.json.skins, `${id}: reviewed skin changed during animation authoring`);
        assert.equal(authored.json.extras?.showdownAnimationBank, PET_SHOWDOWN_ANIMATION_ASSET_REVISION);
        assert.match(authored.json.asset?.generator ?? "", new RegExp(id));
        assert.deepEqual(authored.json.animations.map((animation: { name: string }) => animation.name), EXPECTED_CLIPS);
        for (const animation of authored.json.animations) {
            assert.ok(animation.channels.length >= 4, `${id}/${animation.name}: performance is too sparse`);
            assert.ok(animation.channels.length <= 8, `${id}/${animation.name}: inherited generic all-bone take detected`);
            assert.equal(animation.channels.length, animation.samplers.length);
        }
        assert.ok(authored.file.byteLength > 300_000, `${id}: output is unexpectedly truncated`);
    }
});
