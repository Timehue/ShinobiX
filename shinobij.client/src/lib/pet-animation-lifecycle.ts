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

/** Contact arrives before a stopped presentation clock can advance a fade.
 * Give its authored pose full weight immediately; otherwise the hit freezes
 * a running/idle body while damage and the impact spark have already landed. */
export function transitionPetAnimation(
    next: THREE.AnimationAction,
    previous: THREE.AnimationAction | null,
    duration: number,
    contact: boolean,
): void {
    if (contact) {
        if (previous && previous !== next) previous.stop();
        next.stopFading().setEffectiveWeight(1).play();
    } else {
        next.fadeIn(duration).play();
        previous?.fadeOut(duration * 0.85);
    }
}

/** Sample a host-owned phase without rewinding the mixer's fade clock. */
export function samplePetAnimationPhase(action: THREE.AnimationAction, start: number, end: number, progress: number): void {
    action.time = action.getClip().duration * (start + (end - start) * THREE.MathUtils.clamp(progress, 0, 1));
    action.paused = true;
    action.getMixer().update(0);
}
