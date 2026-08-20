/** Versioned model assets whose skeleton clips were authored for the four-pet
 * Showdown camera instead of inheriting the roster-wide generated motion bank. */
export const PET_SHOWDOWN_ANIMATION_ASSET_REVISION = "20260820-species-v2";

export const PET_SHOWDOWN_ANIMATION_MODEL_IDS: ReadonlySet<string> = new Set([
    "rare-1",              // Frost Hare
    "standard-7",          // Ashen Crow
    "starter-fire-l",      // Inferno Fenrir / chromatic hound silhouette
    "starter-lightning-l", // Raijin Hound
]);

export function petShowdownAnimationModelUrl(visualId: string): string | null {
    if (!PET_SHOWDOWN_ANIMATION_MODEL_IDS.has(visualId)) return null;
    return `/pet-models/showdown-v2/${visualId}.glb?v=${PET_SHOWDOWN_ANIMATION_ASSET_REVISION}`;
}
