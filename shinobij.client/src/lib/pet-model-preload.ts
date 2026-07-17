import { useGLTF } from "@react-three/drei";
import type { Pet } from "../types/pet";
import { petCombatModel } from "./pet-3d-models";

/** Begin fetching and parsing every approved matchup model while the player is
 * still on the Coliseum selection screen. Keeping this in a dynamically loaded
 * module preserves the app's cold-start bundle while preventing the temporary
 * 2D Suspense fallback from becoming the first battle frame. */
export function preloadPetColiseumModels(pets: readonly Pet[]): void {
    const urls = new Set<string>();
    for (const pet of pets) {
        const config = petCombatModel(pet);
        if (!config || urls.has(config.url)) continue;
        urls.add(config.url);
        useGLTF.preload(config.url);
    }
}
