import { useGLTF } from "@react-three/drei";
import type * as THREE from "three";
import type { Pet } from "../types/pet";
import { petCombatModel, showdownFighterIdentity, type ShowdownFighterView } from "./pet-3d-models";
import { preloadPetGlbAtlas } from "./pet-glb-atlas";

/** Begin fetching and parsing every approved matchup model while the player is
 * still on the Coliseum selection screen. Keeping this in a dynamically loaded
 * module preserves the app's cold-start bundle while preventing the temporary
 * 2D Suspense fallback from becoming the first battle frame. */
export async function preloadPetColiseumModels(pets: readonly Pet[]): Promise<void> {
    const urls = new Set<string>();
    const atlasLoads: Array<Promise<THREE.Texture | null>> = [];
    for (const pet of pets) {
        const config = petCombatModel(pet);
        if (!config || urls.has(config.url)) continue;
        urls.add(config.url);
        atlasLoads.push(preloadPetGlbAtlas(config.url));
        useGLTF.preload(config.url);
    }
    await Promise.all(atlasLoads);
}

/** How long a battle may wait on cold models before it starts anyway. The
 *  fallback is not a worse-looking fight, it is an INVISIBLE fighter (the
 *  renderer suspends with a null fallback), so waiting is the better trade —
 *  but never unboundedly, because a stalled CDN must not strand a player in a
 *  lobby with a dead button. */
const SHOWDOWN_MODEL_WARMUP_TIMEOUT_MS = 8000;

/**
 * Warm every model a Showdown session is about to render — BOTH teams.
 *
 * The opponent half is the one that was missing. A Showdown mounts straight
 * into the fight, and an unwarmed GLB suspends against `fallback={null}`: the
 * enemy is not a placeholder for those seconds, it is absent, while your own
 * preloaded pet stands there alone. That reads as a broken fight rather than an
 * opponent — which is the whole reason a level-matched AI is worth having.
 *
 * `ownPets` is your live roster when the caller has it, so your own fighters
 * resolve through their save record (evolution stage included) exactly as the
 * renderer will resolve them.
 *
 * Never rejects and never waits forever: a warm-up is an optimisation, and a
 * failed one must still let the fight start.
 */
export async function warmShowdownModels(
    state: { player: readonly ShowdownFighterView[]; enemy: readonly ShowdownFighterView[] },
    ownPets?: readonly Pet[],
): Promise<void> {
    const roster = [...state.player, ...state.enemy].map((view) => showdownFighterIdentity(view, ownPets));
    await Promise.race([
        preloadPetColiseumModels(roster).catch(() => undefined),
        new Promise<void>((resolve) => setTimeout(resolve, SHOWDOWN_MODEL_WARMUP_TIMEOUT_MS)),
    ]);
}
