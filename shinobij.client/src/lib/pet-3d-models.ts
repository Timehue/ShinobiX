import { petVisualId } from "../data/pet-evolutions";
import type { Pet } from "../types/pet";
import { approvedRosterCombatModel } from "./pet-3d-roster";

export type PetCombatModelProfile = "quadruped" | "biped" | "avian" | "serpentine" | "heavy";

export type PetCombatModelConfig = {
    visualId: string;
    url: string;
    profile: PetCombatModelProfile;
    targetHeight: number;
    fit: "height" | "longest";
    yawOffset: number;
    outlineScale: number;
};

// Ember uses the efficient animated wolf as its anatomical base. Identity comes
// from the authored ninja/element treatment in PetModel3D, not primitive spikes.
const MODEL_URL_OVERRIDES: Readonly<Record<string, string>> = {
    "starter-fire-r": "/pet-models/ember-wolf-rigged.gltf",
    "starter-fire-l": "/pet-models/ember-wolf-rigged.gltf",
    // The evolved Earth reconstruction contains a source planter fused into
    // the animal surface, so a safe topology trim cannot remove it without
    // taking the legs with it. Use the clean approved Earth guardian base at a
    // larger heroic scale; its evolved identity still comes from visualId VFX.
    "starter-earth-l": "/pet-models/starter-earth-r.glb",
};

const MODEL_PROFILES: Readonly<Record<string, PetCombatModelProfile>> = {
    "starter-fire-r": "quadruped",
    "starter-fire-l": "quadruped",
    "starter-water-r": "serpentine",
    "starter-water-l": "serpentine",
    "starter-wind-r": "avian",
    "starter-wind-l": "avian",
    "starter-lightning-r": "quadruped",
    "starter-lightning-l": "quadruped",
    "starter-earth-r": "heavy",
    "starter-earth-l": "heavy",
};

export const PET_COMBAT_MODEL_IDS = Object.freeze(Object.keys(MODEL_PROFILES));

/** Returns a live Coliseum model only for art that has passed the 3D asset gate.
 * Every other pet intentionally falls back to the existing full-body standee. */
export function petCombatModel(pet: Pick<Pet, "id" | "evolutionStage" | "rarity">): PetCombatModelConfig | null {
    // Player/PvP encounter records may append a timestamp to the canonical id.
    // Normalize it before both starter evolution lookup and roster approval so a
    // cloned pet does not silently lose its production model.
    const canonicalId = pet.id.replace(/-\d{10,}$/, "");
    const canonicalPet = canonicalId === pet.id ? pet : { ...pet, id: canonicalId };
    const visualId = petVisualId(canonicalPet);
    const profile = MODEL_PROFILES[visualId];
    if (!profile) return approvedRosterCombatModel(canonicalPet as Pick<Pet, "id" | "name">);
    const overrideUrl = MODEL_URL_OVERRIDES[visualId];
    const isFireRig = visualId.startsWith("starter-fire");
    return {
        visualId,
        url: overrideUrl ?? `/pet-models/${visualId}.glb`,
        profile,
        targetHeight: isFireRig ? (visualId.endsWith("-l") ? 3.55 : 3.3) : visualId.endsWith("-l") ? 2.6 : 2.35,
        fit: isFireRig || profile === "serpentine" ? "longest" : "height",
        yawOffset: 0,
        outlineScale: isFireRig ? 1.018 : 1.026,
    };
}

export function hasPetCombatModel(pet: Pick<Pet, "id" | "evolutionStage" | "rarity">): boolean {
    return petCombatModel(pet) !== null;
}
