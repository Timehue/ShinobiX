/** Versioned model assets whose skeleton clips were authored for the four-pet
 * Showdown camera instead of inheriting the roster-wide generated motion bank. */
export const PET_SHOWDOWN_ANIMATION_ASSET_REVISION = "20260820-species-v2";

export const PET_SHOWDOWN_ANIMATION_MODEL_IDS: ReadonlySet<string> = new Set([
    "rare-1",              // Frost Hare
    "standard-7",          // Ashen Crow
    "starter-fire-l",      // Inferno Fenrir / chromatic hound silhouette
    "starter-lightning-l", // Raijin Hound
]);

/** Asset-space correction from a model's visible forward axis to the combat
 * renderer's +Z convention. The Showdown-v2 Raijin mesh is authored nose-first
 * along local +X; its skeleton's head bone still lies on +Z, so bone-only audits
 * cannot detect this quarter-turn. The other reviewed Showdown-v2 assets are +Z. */
const PET_SHOWDOWN_ANIMATION_YAW_OFFSETS: Readonly<Record<string, number>> = {
    "starter-lightning-l": -Math.PI / 2,
};

export function petShowdownAnimationModelUrl(visualId: string): string | null {
    if (!PET_SHOWDOWN_ANIMATION_MODEL_IDS.has(visualId)) return null;
    return `/pet-models/showdown-v2/${visualId}.glb?v=${PET_SHOWDOWN_ANIMATION_ASSET_REVISION}`;
}

export function petShowdownAnimationYawOffset(visualId: string): number {
    return PET_SHOWDOWN_ANIMATION_YAW_OFFSETS[visualId] ?? 0;
}
