import * as THREE from "three";

/** Cached actions must never outlive the mixer pair that created them. React may
 * retain refs while replacing a memoized GLTF clone, so keep ownership explicit
 * and clear the action cache before the new mixer can render a frame. */
export type PetAnimationEpoch<Family> = {
    mixer: THREE.AnimationMixer | null;
    outlineMixer: THREE.AnimationMixer | null;
    activeClip: THREE.AnimationClip | null;
    activeFamily: Family;
    activeAction: THREE.AnimationAction | null;
    activeOutlineAction: THREE.AnimationAction | null;
};

export function createPetAnimationEpoch<Family>(activeFamily: Family): PetAnimationEpoch<Family> {
    return {
        mixer: null,
        outlineMixer: null,
        activeClip: null,
        activeFamily,
        activeAction: null,
        activeOutlineAction: null,
    };
}

export function synchronizePetAnimationEpoch<Family>(
    epoch: PetAnimationEpoch<Family>,
    mixer: THREE.AnimationMixer | null,
    outlineMixer: THREE.AnimationMixer | null,
    resetFamily: Family,
): boolean {
    if (epoch.mixer === mixer && epoch.outlineMixer === outlineMixer) return false;
    epoch.mixer = mixer;
    epoch.outlineMixer = outlineMixer;
    epoch.activeClip = null;
    epoch.activeFamily = resetFamily;
    epoch.activeAction = null;
    epoch.activeOutlineAction = null;
    return true;
}

/** A component-owned mixer becomes garbage-collectable with its cloned scene.
 * stopAllAction restores/deactivates bindings without destroying their cache.
 * Calling uncacheRoot here is unsafe: StrictMode can reactivate the retained
 * action object, and Three then lends a binding that no longer exists. */
export function retirePetAnimationMixer(mixer: THREE.AnimationMixer | null): void {
    mixer?.stopAllAction();
}
