import { PET_RIG_REPAIR_REVISIONS } from "./pet-proper-animation-assets";

/** Versioned model assets whose skeleton clips were authored for the four-pet
 * Showdown camera instead of inheriting the roster-wide generated motion bank. */
export const PET_SHOWDOWN_ANIMATION_ASSET_REVISION = "20260825-showcase-identity-v3";

export const PET_SHOWDOWN_ANIMATION_MODEL_IDS: ReadonlySet<string> = new Set([
    "rare-1",              // Frost Hare
    "standard-7",          // Ashen Crow
    "starter-fire-l",      // Inferno Fenrir / chromatic hound silhouette
    "starter-lightning-l", // Raijin Hound
]);

/** Asset-space corrections from visible forward to combat +Z. The replacement
 * Raijin sculpt now faces +Z like the other reviewed Showdown models. */
const PET_SHOWDOWN_ANIMATION_YAW_OFFSETS: Readonly<Record<string, number>> = {};

export function petShowdownAnimationModelUrl(visualId: string): string | null {
    if (!PET_SHOWDOWN_ANIMATION_MODEL_IDS.has(visualId)) return null;
    const revision = PET_RIG_REPAIR_REVISIONS[visualId] ?? PET_SHOWDOWN_ANIMATION_ASSET_REVISION;
    return `/pet-models/showdown-v2/${visualId}.glb?v=${revision}`;
}

export function petShowdownAnimationYawOffset(visualId: string): number {
    return PET_SHOWDOWN_ANIMATION_YAW_OFFSETS[visualId] ?? 0;
}
