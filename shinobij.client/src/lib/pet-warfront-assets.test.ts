import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const WARFRONT_MODELS = [
    "../../public/pet-models/gate-warden-rigged.glb",
    "../../public/pet-models/ward-totem.glb",
    "../../public/pet-models/wf-boulder.glb",
    "../../public/pet-models/wf-lantern.glb",
    "../../public/pet-models/roster/rare-24.glb",
    "../../public/pet-models/roster/rare-26.glb",
    "../../public/pet-models/roster/legendary-0.glb",
    "../../public/pet-models/roster/legendary-1.glb",
    "../../public/pet-models/roster/legendary-2.glb",
    "../../public/pet-models/roster/legendary-3.glb",
    "../../public/pet-models/roster/legendary-4.glb",
    "../../public/pet-models/roster/legendary-5.glb",
] as const;

const WARFRONT_ART = [
    "../assets/warfront-three-lane/warfront-three-lane-ground.webp",
    "../assets/warfront-three-lane/warfront-three-lane-ground-portrait.webp",
    "../assets/warfront-three-lane/warfront-three-lane-keyart.webp",
    "../assets/warfront-three-lane/warfront-three-lane-card.webp",
    "../assets/warfront-three-lane/IMAGEGEN_PROMPTS.md",
] as const;

test("Warfront runtime models exist and stay within the audited GLB budget", async () => {
    let total = 0;
    for (const relative of WARFRONT_MODELS) {
        const path = fileURLToPath(new URL(relative, import.meta.url));
        const info = await stat(path);
        total += info.size;
        assert.ok(info.size < 1024 * 1024, `${relative} exceeds the 1 MB per-rig budget`);
    }
    assert.ok(total < 8 * 1024 * 1024, `Warfront preload set is ${(total / 1024 / 1024).toFixed(2)} MB`);
});

test("the three-lane arena art package and reproducible prompt record ship together", async () => {
    for (const relative of WARFRONT_ART) {
        const path = fileURLToPath(new URL(relative, import.meta.url));
        const info = await stat(path);
        assert.ok(info.size > 1_000, `${relative} is missing or unexpectedly empty`);
        assert.ok(info.size < 1024 * 1024, `${relative} exceeds the 1 MB delivery budget`);
    }
});

test("the production Warfront stage consumes the audited rigs, themes, and event stream", async () => {
    const source = await readFile(new URL("../components/PetWarfrontStage3D.tsx", import.meta.url), "utf8");
    for (const asset of ["gate-warden-rigged.glb", "ward-totem.glb", "wf-boulder.glb", "wf-lantern.glb"]) {
        assert.match(source, new RegExp(asset.replace(".", "\\.")), `${asset} is audited but not wired into the stage`);
    }
    assert.match(source, /<PetModel3D\b/);
    assert.match(source, /<WarfrontEventLayer\b/);
    assert.match(source, /WF_THEMES\[theme\]/);
    assert.match(source, /data-theme=\{props\.theme\}/);
});
