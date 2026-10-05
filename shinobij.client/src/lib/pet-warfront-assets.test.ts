import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { rawPetPool } from "../data/pet-pool";
import { STARTER_PETS } from "../data/starter-pets";
import { petWarfrontPortraitSources } from "./pet-battle-anim";

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

test("every built-in and evolved starter pet has a local Warfront portrait fallback", async () => {
    const starterPets = STARTER_PETS.map(({ pet }) => pet);
    const evolvedStarters = STARTER_PETS.flatMap(({ pet }) => [1, 2].map((evolutionStage) => ({
        ...pet,
        evolutionStage: evolutionStage as 1 | 2,
    })));
    const allPets = [...rawPetPool, ...starterPets, ...evolvedStarters];

    for (const pet of allPets) {
        const sources = petWarfrontPortraitSources(pet, {}, true);
        const fallback = sources.at(-1);
        assert.ok(fallback?.startsWith("/pet-poses/") || fallback?.startsWith("/pet-portraits/"),
            `${pet.name} (${pet.id}) has no local static fallback`);
        const path = fileURLToPath(new URL(`../../public${fallback.split("?")[0]}`, import.meta.url));
        const info = await stat(path);
        assert.ok(info.size > 0, `${pet.name} (${pet.id}) fallback image is empty`);
    }
});

test("the legacy base Pebble idle URL serves the replacement cutout", async () => {
    const legacy = fileURLToPath(new URL("../../public/pet-poses/starter-earth-idle.webp", import.meta.url));
    const replacement = fileURLToPath(new URL("../../public/pet-portraits/pebble-tortoise-chibi-v2-cutout.webp", import.meta.url));
    assert.deepEqual(await readFile(legacy), await readFile(replacement));
});
