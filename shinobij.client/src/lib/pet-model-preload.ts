import { useGLTF } from "@react-three/drei";
import type * as THREE from "three";
import type { Pet } from "../types/pet";
import { petCombatModel } from "./pet-3d-models";
import { preloadPetGlbAtlas } from "./pet-glb-atlas";

export const WARFRONT_STATIC_MODEL_URLS = [
    "/pet-models/gate-warden-rigged.glb?v=20260729-rig-v2",
    "/pet-models/ward-totem.glb",
    "/pet-models/wf-boulder.glb",
    "/pet-models/wf-lantern.glb",
] as const;

const WARFRONT_FIXED_PET_MODEL_IDS = [
    "mythic-4",
    "legendary-2",
    "legendary-6",
    "legendary-10",
    "legendary-14",
    "mythic-0",
    "mythic-2",
] as const;

/** Begin fetching and parsing every approved matchup model while the player is
 * still on the Coliseum selection screen. Keeping this in a dynamically loaded
 * module preserves the app's cold-start bundle while preventing the temporary
 * 2D Suspense fallback from becoming the first battle frame. */
export async function preloadPetColiseumModels(pets: readonly Pet[]): Promise<void> {
    const urls = new Set<string>();
    const atlasLoads: Array<Promise<THREE.Texture | null>> = [];
    for (const pet of pets) {
        const config = petCombatModel(pet);
        if (!config || urls.has(config.url)) continue;
        urls.add(config.url);
        atlasLoads.push(preloadPetGlbAtlas(config.url));
        useGLTF.preload(config.url);
    }
    await Promise.all(atlasLoads);
}

/** Warfront entry-point warmup. Call while scouting/countdown UI is visible so
 * the first battle frame can consume useGLTF's parsed cache directly. */
export async function preloadPetWarfrontModels(pets: readonly Pet[]): Promise<void> {
    for (const url of WARFRONT_STATIC_MODEL_URLS) useGLTF.preload(url);
    await preloadPetColiseumModels([
        ...pets,
        ...WARFRONT_FIXED_PET_MODEL_IDS.map((id) => ({ id } as Pet)),
    ]);
}
