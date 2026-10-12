import * as THREE from "three";

type Blend = { start: number; end: number; from: number; to: number };
const pendingFades = new WeakMap<THREE.AnimationMixer, Map<THREE.AnimationAction, Blend>>();

export function petAnimationBlend(delta: number, rate: number): number {
    return 1 - Math.exp(-Math.max(0, delta) * rate);
}

export function advancePetAnimationMixer(mixer: THREE.AnimationMixer, delta: number): void {
    const fades = pendingFades.get(mixer);
    const nextTime = mixer.time + delta * mixer.timeScale;
    if (fades) for (const [action, blend] of fades) {
        const progress = THREE.MathUtils.clamp((nextTime - blend.start) / (blend.end - blend.start), 0, 1);
        const eased = progress * progress * (3 - 2 * progress);
        action.setEffectiveWeight(THREE.MathUtils.lerp(blend.from, blend.to, eased));
        if (progress >= 1) { if (blend.to === 0) action.stop(); fades.delete(action); }
    }
    mixer.update(delta);
}

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
    if (mixer) pendingFades.delete(mixer);
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
    const mixer = next.getMixer();
    let fades = pendingFades.get(mixer);
    if (!fades) { fades = new Map(); pendingFades.set(mixer, fades); }
    if (contact || duration <= 0 || !previous) {
        // A rapid third transition may still be fading the take before
        // `previous`. No outgoing pose may dilute the frozen contact frame.
        for (const action of fades.keys()) if (action !== next) action.stop();
        fades.clear();
        if (previous && previous !== next) previous.stop();
        next.stopFading().setEffectiveWeight(1).play();
    } else {
        // Reversing a fade or interrupting it with a third take starts from
        // the currently displayed blend, rather than resetting its weights.
        // A common envelope keeps total weight at one, so the bind pose never
        // bleeds through (the former outgoing fade ended 15% too early).
        const outgoing = new Set([...fades.keys(), previous]);
        const incomingWeight = outgoing.has(next) ? next.getEffectiveWeight() : 0;
        outgoing.delete(next);
        const start = mixer.time, end = start + duration;
        fades.clear();
        for (const action of outgoing) {
            const from = action.getEffectiveWeight();
            action.stopFading().setEffectiveWeight(from);
            fades.set(action, { start, end, from, to: 0 });
        }
        next.stopFading().setEffectiveWeight(incomingWeight).play();
        fades.set(next, { start, end, from: incomingWeight, to: 1 });
    }
}

/** Carry foot-cycle progress across walk/gallop switches instead of restarting
 * every limb at frame zero when velocity crosses a clip-selection threshold. */
export function synchronizePetLocomotionPhase(next: THREE.AnimationAction, previous: THREE.AnimationAction | null): void {
    if (!previous || previous.getClip().duration <= 0) return;
    const phase = (previous.time / previous.getClip().duration) % 1;
    next.time = phase * next.getClip().duration;
}

/** Set phase before the regular mixer update: host-sampled combat needs only
 * one track evaluation per surface/outline, even while a fade is active. */
export function preparePetAnimationPhase(action: THREE.AnimationAction, start: number, end: number, progress: number): void {
    action.time = action.getClip().duration * (start + (end - start) * THREE.MathUtils.clamp(progress, 0, 1));
    action.paused = true;
}

/** Sample a host-owned phase without rewinding the mixer's fade clock. */
export function samplePetAnimationPhase(action: THREE.AnimationAction, start: number, end: number, progress: number): void {
    preparePetAnimationPhase(action, start, end, progress);
    action.getMixer().update(0);
}
