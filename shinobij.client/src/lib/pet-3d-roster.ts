import type { Pet } from "../types/pet";
import type { PetCombatModelConfig, PetCombatModelProfile } from "./pet-3d-models";

/** Models only enter this list after generation, mesh-budget validation,
 * multi-angle review, and an in-battle pass. Keeping approval in source makes a
 * broken paid generation incapable of silently reaching production. */
export const APPROVED_ROSTER_MODEL_IDS: ReadonlySet<string> = new Set([
    "standard-0", "standard-1", "standard-2", "standard-3", "standard-4",
    "standard-5", "standard-6", "standard-7", "standard-8", "standard-9",
    "standard-10", "standard-11", "standard-12", "standard-13", "standard-14",
    "standard-15", "standard-16", "standard-17", "standard-18", "standard-19",
    "standard-20", "standard-21", "standard-22", "standard-23", "standard-24",
    "standard-25", "standard-26", "standard-27", "standard-28", "standard-29",
    "standard-30", "standard-31", "standard-32", "standard-33", "standard-34",
    "standard-35", "standard-36", "standard-37", "standard-38", "standard-39",
    "standard-40", "standard-41", "standard-42", "standard-43", "standard-44",
    "standard-45", "standard-46", "standard-47", "standard-48", "standard-49",
    "rare-0", "rare-1", "rare-2", "rare-3", "rare-4",
    "rare-5", "rare-6", "rare-7", "rare-8", "rare-9",
    "rare-10", "rare-11", "rare-12", "rare-13", "rare-14",
    "rare-15", "rare-16", "rare-17", "rare-18", "rare-19",
    "rare-20", "rare-21", "rare-22", "rare-23", "rare-24",
    "rare-25", "rare-26", "rare-27", "rare-28", "rare-29",
    "rare-30", "rare-31", "rare-32", "rare-33", "rare-34",
    "rare-35", "rare-36", "rare-37", "rare-38", "rare-39",
    "rare-40", "rare-41", "rare-42", "rare-43", "rare-44",
    "rare-45", "rare-46", "rare-47", "rare-48", "rare-49",
    "legendary-0", "legendary-1", "legendary-2", "legendary-3", "legendary-4",
    "legendary-5", "legendary-6", "legendary-7", "legendary-8", "legendary-9",
    "legendary-10", "legendary-11", "legendary-12", "legendary-13", "legendary-14",
    "legendary-15", "legendary-16", "legendary-17", "legendary-18", "legendary-19",
    "legendary-20", "legendary-21", "legendary-22", "legendary-23", "legendary-24",
    "legendary-25", "legendary-26", "legendary-27", "legendary-28", "legendary-29",
    "mythic-0", "mythic-1", "mythic-2", "mythic-3", "mythic-4",
    "mythic-5", "mythic-6", "mythic-7", "mythic-8", "mythic-9",
]);

// The three built-in Coliseum opponents predate the canonical 140-pet roster,
// so their persistent ids do not have dedicated GLBs. Give each one the closest
// approved species model instead of forcing every AI exhibition back to the
// legacy 2D renderer. Their combat stats, names, elements and kits stay intact;
// this mapping is presentation-only.
const COLISEUM_MODEL_ALIASES: Readonly<Record<string, string>> = {
    "generic-ai-pet-sparrow": "standard-44",   // Glide Sparrow
    "generic-ai-pet-guardhound": "rare-24",    // Young Direwolf
    "generic-ai-pet-emberlynx": "rare-26",     // Ember Ocelot
};

function approvedModelId(id: string): string {
    // Encounter/PvP snapshots can append a timestamp while preserving the
    // canonical pet identity. Match the same suffix rule as battle-sprite art.
    const canonicalId = id.replace(/-\d{10,}$/, "");
    return COLISEUM_MODEL_ALIASES[canonicalId] ?? canonicalId;
}

/** Generated roster art can choose a different locomotion skeleton than the
 * species-name fallback. These explicit entries are added with the model's
 * approval and prevent an upright ninja pet from inheriting quadruped steering. */
export const ROSTER_MODEL_PROFILES: Readonly<Record<string, PetCombatModelProfile>> = {
    "standard-0": "quadruped",
    "standard-1": "biped",
    "standard-2": "biped",
    "standard-3": "avian",
    "standard-4": "biped",
    "standard-5": "biped",
    "standard-6": "biped",
    "standard-7": "avian",
    "standard-8": "biped",
    "standard-9": "biped",
    "standard-10": "avian",
    "standard-11": "biped",
    "standard-12": "biped",
    "standard-13": "heavy",
    "standard-14": "avian",
    "standard-15": "biped",
    "standard-16": "quadruped",
    "standard-17": "avian",
    "standard-18": "biped",
    "standard-19": "biped",
    "standard-20": "biped",
    "standard-21": "quadruped",
    "standard-22": "biped",
    "standard-23": "biped",
    "standard-24": "biped",
    "standard-25": "quadruped",
    "standard-26": "biped",
    "standard-27": "heavy",
    "standard-28": "biped",
    "standard-29": "quadruped",
    "standard-30": "biped",
    "standard-31": "heavy",
    "standard-32": "biped",
    "standard-33": "avian",
    "standard-34": "biped",
    "standard-35": "avian",
    "standard-36": "avian",
    "standard-37": "avian",
    "standard-38": "avian",
    "standard-39": "avian",
    "standard-40": "biped",
    "standard-41": "biped",
    "standard-42": "biped",
    "standard-43": "avian",
    "standard-44": "avian",
    "standard-45": "quadruped",
    "standard-46": "biped",
    "standard-47": "quadruped",
    "standard-48": "biped",
    "standard-49": "biped",
    "rare-0": "quadruped",
    "rare-1": "biped",
    "rare-2": "biped",
    "rare-3": "avian",
    "rare-4": "biped",
    "rare-5": "biped",
    "rare-6": "biped",
    "rare-7": "avian",
    "rare-8": "biped",
    "rare-9": "quadruped",
    "rare-10": "avian",
    "rare-11": "biped",
    "rare-12": "quadruped",
    "rare-13": "heavy",
    "rare-14": "avian",
    "rare-15": "biped",
    "rare-16": "quadruped",
    "rare-17": "avian",
    "rare-18": "biped",
    "rare-19": "biped",
    "rare-20": "biped",
    "rare-21": "biped",
    "rare-22": "quadruped",
    "rare-23": "biped",
    "rare-24": "quadruped",
    "rare-25": "quadruped",
    "rare-26": "quadruped",
    "rare-27": "avian",
    "rare-28": "quadruped",
    "rare-29": "quadruped",
    "rare-30": "biped",
    "rare-31": "quadruped",
    "rare-32": "quadruped",
    "rare-33": "avian",
    "rare-34": "quadruped",
    "rare-35": "avian",
    "rare-36": "avian",
    "rare-37": "avian",
    "rare-38": "avian",
    "rare-39": "avian",
    "rare-40": "biped",
    "rare-41": "biped",
    "rare-42": "biped",
    "rare-43": "biped",
    "rare-44": "avian",
    "rare-45": "biped",
    "rare-46": "biped",
    "rare-47": "quadruped",
    "rare-48": "biped",
    "rare-49": "biped",
    "legendary-0": "quadruped",
    "legendary-1": "avian",
    "legendary-2": "quadruped",
    "legendary-3": "quadruped",
    "legendary-4": "biped",
    "legendary-5": "quadruped",
    "legendary-6": "avian",
    "legendary-7": "serpentine",
    "legendary-8": "quadruped",
    "legendary-9": "heavy",
    "legendary-10": "avian",
    "legendary-11": "serpentine",
    "legendary-12": "biped",
    "legendary-13": "heavy",
    "legendary-14": "avian",
    "legendary-15": "quadruped",
    "legendary-16": "avian",
    "legendary-17": "heavy",
    "legendary-18": "serpentine",
    "legendary-19": "serpentine",
    "legendary-20": "biped",
    "legendary-21": "avian",
    "legendary-22": "quadruped",
    "legendary-23": "quadruped",
    "legendary-24": "quadruped",
    "legendary-25": "biped",
    "legendary-26": "quadruped",
    "legendary-27": "heavy",
    "legendary-28": "biped",
    "legendary-29": "heavy",
    "mythic-0": "quadruped",
    "mythic-1": "quadruped",
    "mythic-2": "heavy",
    "mythic-3": "quadruped",
    "mythic-4": "quadruped",
    "mythic-5": "avian",
    "mythic-6": "serpentine",
    "mythic-7": "biped",
    "mythic-8": "biped",
    "mythic-9": "heavy",
};

const AVIAN = /hawk|crow|owl|crane|gull|moth|heron|finch|swift|swallow|magpie|sparrow|kestrel|cormorant|harrier|osprey|tern|plover|albatross|buzzard|phoenix|raven|garuda|roc/i;
const SERPENTINE = /snake|serpent|eel|minnow|viper|leviathan|wyrm|kraken|dragon|drake|wyvern/i;
const HEAVY = /turtle|tortoise|beetle|boar|bear|crab|armadillo|pangolin|wombat|tapir|aardvark|porcupine|capybara|behemoth|titan|golem|gargoyle|treant/i;

export function inferPet3dProfile(name: string): PetCombatModelProfile {
    if (AVIAN.test(name)) return "avian";
    if (SERPENTINE.test(name)) return "serpentine";
    if (HEAVY.test(name)) return "heavy";
    return "quadruped";
}

export function qaRosterCombatModel(pet: Pick<Pet, "id" | "name">): PetCombatModelConfig {
    const profile = ROSTER_MODEL_PROFILES[pet.id] ?? inferPet3dProfile(pet.name);
    return {
        visualId: pet.id,
        url: `/pet-models/roster/${pet.id}.glb`,
        profile,
        targetHeight: profile === "heavy" ? 2.65 : profile === "serpentine" ? 2.5 : profile === "avian" ? 2.4 : 2.35,
        fit: profile === "serpentine" ? "longest" : "height",
        yawOffset: 0,
        // Smart-UV roster meshes can split vertices at every atlas seam. A
        // scaled backface hull then leaks through those seams as a triangular
        // wireframe, so identity-painted roster art uses its authored ink/rim.
        outlineScale: 1,
    };
}

export function qaRosterProofModel(pet: Pick<Pet, "id" | "name">): PetCombatModelConfig {
    return {
        ...qaRosterCombatModel(pet),
        visualId: `${pet.id}-multiview-proof`,
        url: `/pet-models/proofs/${pet.id}-multiview.glb`,
    };
}

export function qaRosterRiggedProofModel(pet: Pick<Pet, "id" | "name">): PetCombatModelConfig {
    return {
        ...qaRosterCombatModel(pet),
        visualId: `${pet.id}-rigged-proof`,
        url: `/pet-models/proofs/${pet.id}-rigged.glb`,
    };
}

export function qaRosterRetopoProofModel(pet: Pick<Pet, "id" | "name">): PetCombatModelConfig {
    return {
        ...qaRosterCombatModel(pet),
        visualId: `${pet.id}-retopo-proof`,
        url: `/pet-models/proofs/${pet.id}-retopo.glb`,
    };
}

export function qaRosterBakedRetopoProofModel(pet: Pick<Pet, "id" | "name">): PetCombatModelConfig {
    return {
        ...qaRosterCombatModel(pet),
        visualId: `${pet.id}-retopo-baked-proof`,
        url: `/pet-models/proofs/${pet.id}-retopo-baked.glb`,
    };
}

export function approvedRosterCombatModel(pet: Pick<Pet, "id" | "name">): PetCombatModelConfig | null {
    const modelId = approvedModelId(pet.id);
    return APPROVED_ROSTER_MODEL_IDS.has(modelId)
        ? qaRosterCombatModel({ id: modelId, name: pet.name })
        : null;
}
