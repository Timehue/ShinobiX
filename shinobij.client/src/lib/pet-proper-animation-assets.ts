/** Asset revision for the roster-wide identity-performance skeletal pass. */
export const PROPER_PET_ANIMATION_ASSET_REVISION = "20260825-identity-v5";

/** Individual rig repairs invalidate only the model whose mesh/binding changed. */
export const PET_RIG_REPAIR_REVISIONS: Readonly<Record<string, string>> = Object.freeze({
    'legendary-9': '20260909-bear-arm-repair-v1',
    'starter-lightning-l': '20260915-raijin-face-repair-v1',
    'standard-7': '20260916-bird-face-binding-v1',
    'standard-10': '20260916-bird-face-binding-v1',
    'standard-17': '20260916-bird-face-binding-v1',
    'standard-35': '20260916-bird-face-binding-v1',
    'standard-36': '20260916-bird-face-binding-v1',
    'standard-37': '20260916-bird-face-binding-v1',
    'standard-39': '20260916-bird-face-binding-v1',
    'standard-44': '20260916-bird-face-binding-v1',
    'rare-3': '20260916-bird-face-binding-v1',
    'rare-7': '20260916-bird-face-binding-v1',
    'rare-10': '20260916-bird-face-binding-v1',
    'rare-18': '20260916-bird-face-binding-v1',
    'rare-27': '20260916-bird-face-binding-v1',
    'rare-35': '20260916-bird-face-binding-v1',
    'rare-36': '20260916-bird-face-binding-v1',
    'rare-38': '20260916-bird-face-binding-v1',
    'rare-39': '20260916-bird-face-binding-v1',
    'legendary-6': '20260916-bird-face-binding-v1',
    'legendary-14': '20260916-bird-face-binding-v1',
    'legendary-16': '20260916-bird-face-binding-v1',
    'legendary-21': '20260916-bird-face-binding-v1',
    'legendary-10': '20260916-bird-face-binding-v1',
    'rare-17': '20260916-bird-face-binding-v1',
    'rare-37': '20260916-bird-face-binding-v1',
    'rare-44': '20260916-bird-face-binding-v1',
    'legendary-1': '20260916-bird-face-binding-v1',
    'mythic-5': '20260916-bird-face-binding-v1',
    'starter-wind': '20260916-bird-face-binding-v1',
    'starter-wind-r': '20260916-bird-face-binding-v1',
    'starter-wind-l': '20260916-bird-face-binding-v1',
});

/** These four showcase pets keep the detailed individual banks authored before
 * the roster-wide identity pass. Every other production GLB now carries its own
 * deterministic species signature plus dedicated entrance, cast, guard, rest,
 * victory, locomotion, attack, reaction, dodge and defeat performances. */
export const INDIVIDUAL_PET_ANIMATION_MODEL_IDS: ReadonlySet<string> = new Set([
    "rare-1",
    "standard-7",
    "starter-fire-l",
    "starter-lightning-l",
]);
