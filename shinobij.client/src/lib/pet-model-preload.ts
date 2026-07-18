import { useGLTF } from "@react-three/drei";
import type * as THREE from "three";
import type { Pet } from "../types/pet";
import { petCombatModel } from "./pet-3d-models";
import { preloadPetGlbAtlas } from "./pet-glb-atlas";

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
