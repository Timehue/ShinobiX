/** Asset revision for the roster-wide species/family-authored skeletal pass. */
export const PROPER_PET_ANIMATION_ASSET_REVISION = "20260820-family-v3";

/** These four showcase pets keep the more detailed individual banks authored
 * before the roster-wide family pass. Every other production GLB is baked in
 * place with the revision above. */
export const INDIVIDUAL_PET_ANIMATION_MODEL_IDS: ReadonlySet<string> = new Set([
    "rare-1",
    "standard-7",
    "starter-fire-l",
    "starter-lightning-l",
]);
