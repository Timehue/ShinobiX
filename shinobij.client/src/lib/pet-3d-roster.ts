import type { Pet } from "../types/pet";
import type { PetCombatModelConfig, PetCombatModelProfile } from "./pet-3d-models";
import {
    HOLLOW_HOUND_MODEL_SOURCE_ID,
    isHollowHoundEncounterId,
} from "../../../shared/hollow-gate-contract";
import { petShowdownAnimationModelUrl, petShowdownAnimationYawOffset } from "./pet-showdown-animation-assets";
import { PET_RIG_REPAIR_REVISIONS, PROPER_PET_ANIMATION_ASSET_REVISION } from "./pet-proper-animation-assets";

/** Models only enter this list after generation, mesh-budget validation,
 * multi-angle review, and an in-battle pass. Keeping approval in source makes a
 * broken paid generation incapable of silently reaching production. */
const ROSTER_RARITY_COUNTS = [
    ["standard", 50],
    ["rare", 50],
    ["legendary", 30],
    ["mythic", 16],
] as const;

const APPROVED_ROSTER_MODEL_ID_LIST: readonly string[] = Object.freeze(
    ROSTER_RARITY_COUNTS.flatMap(([rarity, count]) =>
        Array.from({ length: count }, (_, index) => `${rarity}-${index}`)),
);

export const APPROVED_ROSTER_MODEL_IDS: ReadonlySet<string> = new Set(APPROVED_ROSTER_MODEL_ID_LIST);

/**
 * Roster GLBs were replaced in-place during the reconstruction/rigging pass.
 * Drei's useGLTF cache is URL keyed, so a stable path can otherwise keep an
 * early untextured or untrimmed candidate alive for the rest of the browser
 * session. Bump this revision whenever the approved production GLBs change.
 */
export const ROSTER_MODEL_ASSET_REVISION = PROPER_PET_ANIMATION_ASSET_REVISION;

function rosterModelUrl(id: string): string {
    const revision = PET_RIG_REPAIR_REVISIONS[id] ?? ROSTER_MODEL_ASSET_REVISION;
    return petShowdownAnimationModelUrl(id)
        ?? `/pet-models/roster/${id}.glb?v=${revision}`;
}

// The three built-in Coliseum opponents predate the canonical pet roster, so
// their persistent ids intentionally reuse the closest approved species rig.
// Additional Mythics have dedicated production assets and therefore do
// not belong in this presentation-only alias map.
const COLISEUM_MODEL_ALIASES: Readonly<Record<string, string>> = {
    "generic-ai-pet-sparrow": "standard-44",   // Glide Sparrow
    "generic-ai-pet-guardhound": "rare-24",    // Young Direwolf
    "generic-ai-pet-emberlynx": "rare-26",     // Ember Ocelot
};

function approvedModelId(id: string): string {
    if (isHollowHoundEncounterId(id)) return HOLLOW_HOUND_MODEL_SOURCE_ID;
    // Encounter/PvP snapshots can append a timestamp while preserving the
    // canonical pet identity. Match the same suffix rule as battle-sprite art.
    const canonicalId = id.replace(/-\d{10,}$/, "");
    return COLISEUM_MODEL_ALIASES[canonicalId] ?? canonicalId;
}

/** Generated roster art can choose a different locomotion skeleton than the
 * species-name fallback. These explicit entries are added with the model's
 * approval and prevent an upright ninja pet from inheriting quadruped steering. */
const PROFILE_BY_CODE: Readonly<Record<string, PetCombatModelProfile>> = {
    q: "quadruped",
    b: "biped",
    a: "avian",
    h: "heavy",
    s: "serpentine",
};

// One reviewed locomotion code per approved model, in roster index order.
const ROSTER_PROFILE_CODES = [
    ["standard", "qbbabbbabbabbhabqabbbqbbbqbhbqbhbabaaaaabbbaaqbqbb"],
    ["rare", "qbbabbbabqabqhabqabbbbqbqqqaqqbqqaqaaaaabbbbabbqbb"],
    ["legendary", "qaqqbqasqhasbhaqahssbaqqqbqhbh"],
    ["mythic", "qqhqqasbbhasqqhq"],
] as const;

export const ROSTER_MODEL_PROFILES: Readonly<Record<string, PetCombatModelProfile>> = Object.fromEntries(
    ROSTER_PROFILE_CODES.flatMap(([rarity, codes]) =>
        [...codes].map((code, index) => [`${rarity}-${index}`, PROFILE_BY_CODE[code]])),
);

const AVIAN = /hawk|crow|owl|crane|gull|moth|heron|finch|swift|swallow|magpie|sparrow|kestrel|cormorant|harrier|osprey|tern|plover|albatross|buzzard|phoenix|raven|garuda|roc/i;
const SERPENTINE = /snake|serpent|eel|minnow|viper|leviathan|wyrm|kraken|dragon|drake|wyvern/i;
const HEAVY = /turtle|tortoise|beetle|boar|bear|crab|armadillo|pangolin|wombat|tapir|aardvark|porcupine|capybara|behemoth|titan|golem|gargoyle|treant/i;

export function inferPet3dProfile(name: string): PetCombatModelProfile {
    if (AVIAN.test(name)) return "avian";
    if (SERPENTINE.test(name)) return "serpentine";
    if (HEAVY.test(name)) return "heavy";
    return "quadruped";
}

/** Mesh-space corrections into the renderer's +Z forward convention.
 * Use the visible production mesh, not the skeleton alone: generated geometry
 * can point in a different direction from the bones it was bound to. Umbra's
 * torso and muzzle point diagonally along +X/+Z. Worldroot and Ironfang now
 * face +Z, so their old stock-rig half-turns must not be reapplied. */
const ROSTER_YAW_CORRECTIONS: Readonly<Record<string, number>> = {
    "standard-36": Math.PI,       // Dust Swift
    "rare-42": -Math.PI / 8,      // Thunder Jerboa
    "rare-43": -Math.PI / 4,      // Static Meerkat
    "rare-46": -Math.PI / 4,      // Stoneback Tapir
    "rare-48": -Math.PI / 8,      // Terra Porcupine
    "rare-49": -Math.PI / 4,      // Bramble Capybara
    "legendary-0": -Math.PI / 4,  // Glacier Wolf
    "legendary-2": -Math.PI / 4,  // Umbra Fox
    "legendary-5": -Math.PI / 8,  // Azure Kirin
    "legendary-6": -Math.PI / 8,  // Ember Phoenix
    "legendary-10": Math.PI / 8,  // Void Raven
    "legendary-12": -Math.PI / 4, // Frost Lynx
    "legendary-14": -Math.PI / 4, // Ancient Crane
    "mythic-3": Math.PI / 2,     // Solar Stag
};

export function qaRosterCombatModel(pet: Pick<Pet, "id" | "name">): PetCombatModelConfig {
    const profile = ROSTER_MODEL_PROFILES[pet.id] ?? inferPet3dProfile(pet.name);
    return {
        visualId: pet.id,
        url: rosterModelUrl(pet.id),
        profile,
        targetHeight: profile === "heavy" ? 2.65 : profile === "serpentine" ? 2.5 : profile === "avian" ? 2.4 : 2.35,
        fit: profile === "serpentine" ? "longest" : "height",
        yawOffset: (ROSTER_YAW_CORRECTIONS[pet.id] ?? 0) + petShowdownAnimationYawOffset(pet.id),
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
    // Resolve to the allowlist's OWN string rather than the caller's. The returned
    // url is fetched (the persistent colour atlas), and pet ids arrive from saves
    // and PvP encounter snapshots, so the path segment has to be a literal this
    // module owns — not a copy of the id that merely passed a membership check.
    const requestedId = approvedModelId(pet.id);
    const modelId = APPROVED_ROSTER_MODEL_ID_LIST.find((id) => id === requestedId);
    return modelId ? qaRosterCombatModel({ id: modelId, name: pet.name }) : null;
}
