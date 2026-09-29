import * as THREE from 'three';
import type { RallyMotion } from '../../../../shared/sunscar/rally-types';

/** Small secondary motion on the rig's parent; physics and collision stay exact. */
export function rallyBodyPose(motion: RallyMotion, steering: number, verticalSpeed: number, recoilTicks: number, reducedMotion: boolean) {
    if (reducedMotion || motion === 'ready' || motion === 'victory' || motion === 'defeat') return { bank: 0, pitch: 0, squash: 1 };
    return {
        bank: Math.max(-.16, Math.min(.16, -steering * .18)),
        pitch: motion === 'jump' || motion === 'airborne' ? Math.max(-.12, Math.min(.12, verticalSpeed * .025)) : recoilTicks > 0 ? -.09 * recoilTicks / 27 : 0,
        squash: motion === 'land' ? .9 : motion === 'jump' ? 1.04 : 1,
    };
}

export function rallyAnimationDelta(delta: number, moving: boolean, ready: boolean, finished: boolean) {
    return moving || ready || finished ? Math.max(0, Math.min(delta, .05)) : 0;
}

export const RALLY_CLIP_MAP: Record<RallyMotion, string> = {
    ready: 'guard', start: 'gallop', run: 'gallop', sprint: 'gallop', jump: 'gallop_jump',
    airborne: 'gallop_jump', land: 'gallop_jump', stagger: 'idle_hitreact1', technique: 'gallop', victory: 'victory', defeat: 'rest',
};
/** Every supported morphology already has authored bone animation, including
 * wings/tails. Reuse it without a mesh-deformation fallback or a second rig. */
export function prepareRallyClips(clips: readonly THREE.AnimationClip[]): Map<string, THREE.AnimationClip> {
    const bank = new Map<string, THREE.AnimationClip>();
    for (const source of clips) {
        const clip = source.clone();
        // Game physics owns displacement. Preserve local joint animation, strip
        // only whole-skeleton root translation to prevent double root motion.
        clip.tracks = clip.tracks.filter(track => !/^(root|Armature)\.position$/i.test(track.name));
        bank.set(clip.name, clip);
    }
    for (const name of new Set(Object.values(RALLY_CLIP_MAP))) if (!bank.has(name)) throw new Error(`This pet is missing its ${name} animation.`);
    return bank;
}
export function rallyClipSpeed(motion: RallyMotion, speed: number): number {
    return ['run', 'start', 'sprint', 'technique'].includes(motion) ? Math.max(.65, Math.min(1.65, speed / 15)) : 1;
}
