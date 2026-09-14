import { test } from "node:test";
import assert from "node:assert/strict";
import { stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const WARFRONT_MODELS = [
    "../../public/pet-models/roster/rare-24.glb",
    "../../public/pet-models/roster/rare-26.glb",
    "../../public/pet-models/roster/legendary-0.glb",
    "../../public/pet-models/roster/legendary-1.glb",
    "../../public/pet-models/roster/legendary-2.glb",
    "../../public/pet-models/roster/legendary-3.glb",
    "../../public/pet-models/roster/legendary-4.glb",
    "../../public/pet-models/roster/legendary-5.glb",
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
