import { test } from "node:test";
import assert from "node:assert/strict";
import { stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const WARFRONT_MODELS = [
    "../../public/pet-models/gate-warden-rigged.glb",
    "../../public/pet-models/ward-totem.glb",
    "../../public/pet-models/wf-boulder.glb",
    "../../public/pet-models/wf-lantern.glb",
    "../../public/pet-models/roster/mythic-4.glb",
    "../../public/pet-models/roster/legendary-2.glb",
    "../../public/pet-models/roster/legendary-6.glb",
    "../../public/pet-models/roster/legendary-10.glb",
    "../../public/pet-models/roster/legendary-14.glb",
    "../../public/pet-models/roster/mythic-0.glb",
    "../../public/pet-models/roster/mythic-2.glb",
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
