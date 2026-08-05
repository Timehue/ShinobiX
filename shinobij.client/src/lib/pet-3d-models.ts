import { petVisualId } from "../data/pet-evolutions";
import type { Pet } from "../types/pet";
import { approvedRosterCombatModel } from "./pet-3d-roster";

export type PetCombatModelProfile = "quadruped" | "biped" | "avian" | "serpentine" | "heavy";

export type PetCombatModelConfig = {
    visualId: string;
    /** Logical starter identity when a retired model is backed by a different
     * reviewed GLB. Asset-specific rendering still keys off `visualId`. */
    identityVisualId?: string;
    url: string;
    profile: PetCombatModelProfile;
    targetHeight: number;
    fit: "height" | "longest";
    yawOffset: number;
    outlineScale: number;
};

/** Models that remain combat-readable at arena distance but do not yet meet the
 * identity bar for large, first-impression portraits. */
const CLOSEUP_MODEL_FALLBACKS: ReadonlySet<string> = new Set([
    "starter-wind-l",
]);

/** Cache revision shared by all 15 starter production GLBs. */
export const STARTER_MODEL_ASSET_REVISION = "20260728-grounded-meshopt-v2";

const MODEL_URL_OVERRIDES: Readonly<Record<string, string>> = {
    // Rebuilt from a seal-specific three-quarter reference. The first rare-water
    // reconstruction inherited the source sprite's upright mascot silhouette and
    // read as a round dolphin/blob in battle; this candidate has a full horizontal
    // torso, separate front/rear flippers and a readable tail.
    "starter-water-r": "/pet-models/starter-water-r.glb",
};

const MODEL_PROFILES: Readonly<Record<string, PetCombatModelProfile>> = {
    "starter-fire": "quadruped",
    "starter-fire-r": "quadruped",
    "starter-fire-l": "quadruped",
    "starter-water": "serpentine",
    "starter-water-r": "serpentine",
    "starter-water-l": "serpentine",
    "starter-wind": "avian",
    "starter-wind-r": "avian",
    "starter-wind-l": "avian",
    "starter-lightning": "quadruped",
    "starter-lightning-r": "quadruped",
    "starter-lightning-l": "quadruped",
    "starter-earth": "heavy",
    "starter-earth-r": "heavy",
    "starter-earth-l": "heavy",
};

const MODEL_TARGET_HEIGHTS: Readonly<Record<string, number>> = {
    "starter-fire": 2.05,
    "starter-fire-r": 3.3,
    "starter-fire-l": 3.55,
    "starter-water": 1.5,
    "starter-wind": 1.8,
    "starter-lightning": 2.05,
    "starter-earth": 1.95,
};

const MODEL_FIT_OVERRIDES: Readonly<Record<string, PetCombatModelConfig["fit"]>> = {
    "starter-fire-r": "longest",
    "starter-fire-l": "longest",
};

/** Starter assets that have been retired from live presentation while keeping
 * their persistent pet identity. Pebble's original reconstruction duplicated
 * the segmented shell pattern as a second cap on its head. Stone Turtle is the
 * reviewed biped tortoise rig: one back shell, a normal head, and the same ninja
 * silhouette as Pebble's authored portrait. */
const STARTER_ROSTER_MODEL_REPLACEMENTS: Readonly<Record<string, string>> = {
    "starter-earth": "standard-5",
};

export const PET_COMBAT_MODEL_IDS = Object.freeze(Object.keys(MODEL_PROFILES));

type PetCombatModelIdentity = Pick<Pet, "id" | "evolutionStage" | "rarity">
    & Partial<Pick<Pet, "templateId" | "name">>;

/** Returns a live Coliseum model only for art that has passed the 3D asset gate.
 * Every other pet intentionally falls back to the existing full-body standee. */
export function petCombatModel(pet: PetCombatModelIdentity): PetCombatModelConfig | null {
    // Player/PvP encounter records may append a timestamp to the canonical id.
    // Normalize it before both starter evolution lookup and roster approval so a
    // cloned pet does not silently lose its production model.
    const canonicalId = pet.id.replace(/-\d{10,}$/, "");
    const instanceSeparator = canonicalId.indexOf(":");
    const legacyInstanceTemplate = instanceSeparator > 0 ? canonicalId.slice(0, instanceSeparator) : "";
    const explicitTemplate = typeof pet.templateId === "string" ? pet.templateId.trim() : "";
    const canonicalPet: PetCombatModelIdentity = {
        ...pet,
        id: canonicalId,
        ...((explicitTemplate || legacyInstanceTemplate)
            ? { templateId: explicitTemplate || legacyInstanceTemplate }
            : {}),
    };
    // Resolve to the approved list's OWN string, not the derived one: `url` below
    // is fetched for the colour atlas, and pet ids come from saves and encounter
    // snapshots, so the path segment must be a literal this module owns.
    const requestedVisualId = petVisualId(canonicalPet);
    const replacementModelId = STARTER_ROSTER_MODEL_REPLACEMENTS[requestedVisualId];
    if (replacementModelId) {
        const replacement = approvedRosterCombatModel({
            id: replacementModelId,
            name: canonicalPet.name ?? "Pebble Tortoise",
        });
        return replacement
            ? {
                ...replacement,
                identityVisualId: requestedVisualId,
                targetHeight: MODEL_TARGET_HEIGHTS[requestedVisualId] ?? replacement.targetHeight,
            }
            : null;
    }
    const visualId = PET_COMBAT_MODEL_IDS.find((id) => id === requestedVisualId);
    if (visualId === undefined) {
        return approvedRosterCombatModel({ id: requestedVisualId, name: canonicalPet.name ?? requestedVisualId });
    }
    const profile = MODEL_PROFILES[visualId];
    const overrideUrl = MODEL_URL_OVERRIDES[visualId];
    const isRareWaterSelkie = visualId === "starter-water-r";
    const targetHeight = MODEL_TARGET_HEIGHTS[visualId];
    return {
        visualId,
        url: `${overrideUrl ?? `/pet-models/${visualId}.glb`}?v=${STARTER_MODEL_ASSET_REVISION}`,
        profile,
        targetHeight: targetHeight ?? (isRareWaterSelkie ? 1.65 : visualId.endsWith("-l") ? 2.6 : 2.35),
        fit: MODEL_FIT_OVERRIDES[visualId] ?? (isRareWaterSelkie ? "height" : profile === "serpentine" ? "longest" : "height"),
        yawOffset: 0,
        outlineScale: 1.026,
    };
}

export function hasPetCombatModel(pet: PetCombatModelIdentity): boolean {
    return petCombatModel(pet) !== null;
}

/** Returns a model only when it is approved for a large cinematic portrait.
 * Callers with pose artwork use null as the deliberate 2D fallback signal. */
export function petCloseupPresentationModel(
    pet: PetCombatModelIdentity,
): PetCombatModelConfig | null {
    const config = petCombatModel(pet);
    return config && !CLOSEUP_MODEL_FALLBACKS.has(config.visualId) ? config : null;
}

/** Root-hop scale for the one-shot winner celebration. Winged pets already gain
 * silhouette from their authored clip, so their body stays near floor contact. */
function petVictoryArcScale(
    profile: PetCombatModelProfile,
    aquaticSeal: boolean,
): number {
    if (aquaticSeal || profile === "serpentine") return 0.02;
    if (profile === "avian") return 0.02;
    if (profile === "heavy") return 0.03;
    if (profile === "biped") return 0.045;
    return 0.055;
}

/** Maximum world-space height for the celebration's launch-and-plant beat.
 * The absolute cap prevents evolved and legendary pets from hopping farther
 * merely because their presentation target is taller. */
export function petVictoryArcHeight(
    targetHeight: number,
    profile: PetCombatModelProfile,
    aquaticSeal: boolean,
): number {
    return Math.min(0.12, Math.max(0, targetHeight) * petVictoryArcScale(profile, aquaticSeal));
}
