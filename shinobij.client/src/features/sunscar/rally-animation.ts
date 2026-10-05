import * as THREE from 'three';
import type { RallyMotion } from '../../../../shared/sunscar/rally-types';
import { rallyPresentationDelta } from './rally-presentation-clock';

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
    // Keep gait cadence in step with race physics on 10–20 FPS devices. Finish
    // presentation keeps its existing 50 ms clock so the podium can settle fully.
    if (finished || ready) return rallyPresentationDelta(delta);
    return moving && Number.isFinite(delta) ? Math.max(0, Math.min(delta, .1)) : 0;
}

/** Physics stops each racer on its finish tick, so its last running/jump state
 * remains in the saved race. Present a planted waiting pose until all finish. */
export function rallyWaitingMotion(motion: RallyMotion, finishTick: number | null, raceFinished: boolean): RallyMotion {
    return finishTick !== null && !raceFinished ? 'ready' : motion;
}

export const RALLY_CLIP_MAP: Record<RallyMotion, string> = {
    ready: 'guard', start: 'gallop', run: 'gallop', sprint: 'gallop', jump: 'gallop_jump',
    airborne: 'gallop_jump', land: 'gallop_jump', stagger: 'idle_hitreact1', technique: 'gallop', victory: 'victory', defeat: 'rest',
};

/** Sample the authored tuck and extension against the actual jump instead of
 * freezing every airborne pet at the same mid-clip pose. */
export function rallyJumpPhase(motion: RallyMotion, verticalSpeed: number, landingTicks: number): number | null {
    if (motion === 'jump') return .08 + (1 - THREE.MathUtils.clamp((verticalSpeed - 3) / 7, 0, 1)) * .3;
    if (motion === 'airborne') return .38 + THREE.MathUtils.clamp(-verticalSpeed / 10, 0, 1) * .36;
    if (motion === 'land') return .74 + (1 - THREE.MathUtils.clamp(landingTicks / 11, 0, 1)) * .26;
    return null;
}

/** Production rigs have knees and paws, but the general movement bank only
 * keys their upper limbs. Add small local joint counter-rotation where a real
 * parent limb is keyed and its lower joint has no authored track. Detailed
 * specialist takes, wings and serpentine motion retain their own choreography.
 * This is prepared once; playback uses the same mixer and skinning pass. */
function completeRallyStride(clip: THREE.AnimationClip, rig: THREE.Object3D) {
    const bones = new Map<string, THREE.Bone>();
    rig.traverse(node => { if (node instanceof THREE.Bone) bones.set(node.name, node); });
    const keyed = new Set(clip.tracks.map(track => track.name));
    const rotation = new THREE.Quaternion();
    const relative = new THREE.Quaternion();
    const bend = new THREE.Quaternion();
    const pitch = new THREE.Euler();
    const axis = new THREE.Vector3(1, 0, 0);
    for (const source of [...clip.tracks]) {
        const match = /^((?:front|hind)_upper|thigh|upper_arm)(\.?[LR])\.quaternion$/.exec(source.name);
        if (!match || source.getValueSize() !== 4) continue;
        const upper = bones.get(`${match[1]}${match[2]}`);
        if (!upper) continue;
        const lowerPrefix = match[1] === 'thigh' ? 'shin' : match[1] === 'upper_arm' ? 'forearm' : match[1].replace('upper', 'lower');
        const tipPrefix = match[1] === 'thigh' ? 'foot' : match[1] === 'upper_arm' ? 'hand' : match[1].replace('upper', 'paw');
        const lower = bones.get(`${lowerPrefix}${match[2]}`);
        if (!lower || lower.parent !== upper) continue;
        // Never modify an individually authored knee/elbow (or its foot).
        if (keyed.has(`${lower.name}.quaternion`)) continue;
        const tip = bones.get(`${tipPrefix}${match[2]}`);
        const upperBindInverse = upper.quaternion.clone().invert();
        const lowerValues: number[] = [];
        const tipValues: number[] = [];
        const leverage = match[1] === 'thigh' ? -.5 : match[1] === 'upper_arm' ? -.3 : -.4;
        for (let key = 0; key < source.times.length; key++) {
            relative.copy(upperBindInverse).multiply(rotation.fromArray(source.values, key * 4));
            pitch.setFromQuaternion(relative, 'XYZ');
            // The generic bank's widest swings can stretch the chibi forelimb
            // silhouette into a flat paddle. Keep the authored timing and side
            // accents, but bound that unarticulated shoulder/hip excursion.
            const swing = THREE.MathUtils.clamp(pitch.x, -.48, .48);
            if (swing !== pitch.x) {
                pitch.x = swing;
                rotation.copy(upper.quaternion).multiply(relative.setFromEuler(pitch)).normalize().toArray(source.values, key * 4);
            }
            const lowerAngle = swing * leverage;
            rotation.copy(lower.quaternion).multiply(bend.setFromAxisAngle(axis, lowerAngle)).normalize().toArray(lowerValues, key * 4);
            if (tip?.parent === lower && !keyed.has(`${tip.name}.quaternion`)) {
                rotation.copy(tip.quaternion).multiply(bend.setFromAxisAngle(axis, -lowerAngle * .65)).normalize().toArray(tipValues, key * 4);
            }
        }
        clip.tracks.push(new THREE.QuaternionKeyframeTrack(`${lower.name}.quaternion`, source.times, lowerValues));
        if (tip && tipValues.length) clip.tracks.push(new THREE.QuaternionKeyframeTrack(`${tip.name}.quaternion`, source.times, tipValues));
    }
}

/** Keep the existing anatomy-authored bank and improve its rally stride without
 * extra models, textures, or per-frame mesh deformation. Cached GLTF clips and
 * the rig's bind pose remain untouched. */
export function prepareRallyClips(clips: readonly THREE.AnimationClip[], rig?: THREE.Object3D, reducedMotion = false, preserveAuthoredStride = false): Map<string, THREE.AnimationClip> {
    const bank = new Map<string, THREE.AnimationClip>();
    for (const source of clips) {
        const clip = source.clone();
        clip.tracks = clip.tracks.filter(track => {
            if (!/^(root|Armature)\.position$/i.test(track.name)) return true;
            if (clip.name !== 'gallop' || reducedMotion) return false;
            // Physics owns travel and jumps; a gallop's vertical weight transfer
            // is local body motion. Pin horizontal offsets while retaining the
            // original vertical stride, which was previously stripped as well.
            if (track.getValueSize() !== 3) return false;
            for (let key = 0; key < track.values.length; key += 3) {
                track.values[key] = track.values[0];
                track.values[key + 2] = track.values[2];
            }
            return true;
        });
        if (rig && clip.name === 'gallop' && !preserveAuthoredStride) completeRallyStride(clip, rig);
        bank.set(clip.name, clip);
    }
    for (const name of new Set(Object.values(RALLY_CLIP_MAP))) if (!bank.has(name)) throw new Error(`This pet is missing its ${name} animation.`);
    return bank;
}
export function rallyClipSpeed(motion: RallyMotion, speed: number): number {
    return ['run', 'start', 'sprint', 'technique'].includes(motion) ? Math.max(0, Math.min(1.9, speed / 15)) : 1;
}
