import type { Pet } from "../types/pet";
import { preloadPetColiseumModels } from "./pet-model-preload";
import { warfrontPetModelConfig } from "./pet-warfront-model-lod";

/** Use the certified squad meshes for both warmup and the mounted board. */
export function preloadGauntletPets(pets: Pet[]): Promise<void> {
    return preloadPetColiseumModels(pets, warfrontPetModelConfig);
}
