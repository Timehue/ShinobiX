import { Bone, MathUtils, type Quaternion, type Object3D, type AnimationClip } from 'three';
import type { PetCombatMotion } from './pet-combat-performance';

type Joint = [bone: Bone, pose: Quaternion, track: string, role: 'wing' | 'leg' | 'neck' | 'chest', side: number, gain: number, offset: number, paired: boolean];
type RigMotionFrame = { motion: PetCombatMotion; timeline: number; delta: number; phase: number; galloping: boolean;
    locomotion: boolean; wingPhase: number | null; breath: number; lookYaw: number; contact: boolean; };
const canonical = (name: string) => name.replace(/[._]([LR])$/u, '$1');
const { sin, cos, atan2, exp, max, PI } = Math;

/** Small skeletal secondary motions for the inspected roster topology.
 * No mesh deformation or limb guessing from a creature's presentation profile.
 * Save the mixer-produced pose and restore BEFORE its next evaluation: unkeyed
 * joints otherwise accumulate the delta and leak it into guard/KO/idle.
 * Detailed showcase takes retain their authored leg/head performances. */
export function createPetCombatRigMotion(scenes: readonly (Object3D | null)[], detailed = false) {
    const joints: Joint[] = [];
    for (const scene of scenes) {
        if (!scene) continue;
        const bones = new Map<string, Bone>();
        scene.traverse(node => { if (node instanceof Bone) bones.set(canonical(node.name), node); });
        const add = (bone: Bone, role: Joint[3], side = 1, gain = 1, offset = 0, paired = false) =>
            joints.push([bone, bone.quaternion.clone(), `${bone.name}.quaternion`, role, side, gain, offset, paired]);
        for (const side of ['L', 'R']) {
            const sign = side === 'L' ? 1 : -1;
            const upperWing = bones.get(`wing_upper${side}`), midWing = bones.get(`wing_mid${side}`);
            // Other wings (bat, moth, winged lion) have different axes/banks.
            if (upperWing && midWing?.parent === upperWing) { add(upperWing, 'wing', sign); add(midWing, 'wing', sign, .55); }
            if (detailed) continue;
            for (const [upperName, lowerName, tipName, offset] of [
                ['front_upper','front_lower','front_paw',0], ['hind_upper','hind_lower','hind_paw',.5], ['thigh','shin','foot',.5],
            ] as const) {
                const upper = bones.get(upperName+side), lower = bones.get(lowerName+side), tip = bones.get(tipName+side);
                if (!upper || lower?.parent !== upper || tip?.parent !== lower) continue;
                // All thigh banks (biped, avian, bat) swing forward in the
                // opposite half-cycle from quadruped front-shoulder banks.
                // Bipeds keep alternating feet at speed; only quadruped banks
                // pair left/right forelegs and hindlegs through their gallop.
                const pairedGallop = upperName !== 'thigh';
                // Store the recovery rotation gain once for both distal joints.
                add(lower, 'leg', sign, -1, offset, pairedGallop);
                add(tip, 'leg', sign, .65, offset, pairedGallop);
            }
        }
        if (!detailed) {
            const neck = bones.get('neck'), head = bones.get('head'), chest = bones.get('chest');
            if (neck && head?.parent === neck) add(neck, 'neck');
            if (chest && neck?.parent === chest) add(chest, 'chest');
        }
    }
    const keyedJoints = new WeakMap<AnimationClip, Set<string>>();
    let applied = false, gaitWeight = 0, attentiveWeight = 0, look = 0;
    const restore = () => { if (!applied) return; for (const [bone, pose] of joints) bone.quaternion.copy(pose); applied = false; };
    return {
        jointCount: joints.length,
        restore,
        reset: () => { restore(); gaitWeight = 0; attentiveWeight = 0; look = 0; },
        apply: (frame: RigMotionFrame, clip: AnimationClip | null) => {
            restore();
            let keyed = clip ? keyedJoints.get(clip) : undefined;
            if (clip && !keyed) { keyed = new Set(clip.tracks.map(track => track.name)); keyedJoints.set(clip, keyed); }
            const blend = 1 - exp(-max(0, frame.delta) * 12);
            const neutral = frame.motion === 'idle' || frame.motion === 'guard' || frame.motion === 'rest';
            // Contact/KO owns its exact authored silhouette, including hit-stop.
            const committed = frame.contact || frame.motion === 'dead' || frame.motion === 'stagger';
            gaitWeight = committed ? 0 : MathUtils.lerp(gaitWeight, frame.locomotion ? 1 : 0, blend);
            attentiveWeight = committed ? 0 : MathUtils.lerp(attentiveWeight, neutral ? 1 : 0, blend);
            const lookError = atan2(sin(frame.lookYaw), cos(frame.lookYaw));
            look = MathUtils.lerp(look, MathUtils.clamp(lookError, -.16, .16), blend);
            for (const [bone, pose, track, role, side, gain, offset, paired] of joints) {
                pose.copy(bone.quaternion);
                if (role === 'wing') {
                    if (frame.wingPhase === null || committed) continue;
                    // Current feather weights tolerate a restrained fold; the
                    // former >1 radian drive sheared their layered wing tips.
                    // Land unkeyed middle wings before the clip changes. A
                    // terminal offset otherwise snaps off on return to idle.
                    const phase = MathUtils.clamp(frame.wingPhase, 0, 1);
                    const envelope = MathUtils.smoothstep(phase, 0, .12) * (1 - MathUtils.smoothstep(phase, .78, 1));
                    const spread = (.22 + (.5 + sin(phase * PI * 3.2) * .5) * .44) * envelope;
                    bone.rotateX(side * spread * gain);
                    bone.rotateZ(side * .08 * gain * sin(PI * phase) * envelope);
                } else if (role === 'leg') {
                    // Supplement only unkeyed distal joints. Imported authored
                    // knee/ankle curves always win over this recovery layer.
                    if (gaitWeight === 0 || keyed?.has(track)) continue;
                    const sideOffset = frame.galloping && paired ? 0 : side < 0 ? .5 : 0;
                    const swing = max(0, sin((frame.phase + offset + sideOffset + .5) * PI * 2));
                    const flex = swing * swing * gaitWeight * (frame.galloping ? .42 : .28);
                    bone.rotateX(flex * gain);
                } else if (attentiveWeight !== 0) {
                    // The authored head take remains intact; neck attention is
                    // restrained and driven by the same slowed combat clock.
                    if (role === 'neck') bone.rotateY(attentiveWeight * (look + sin(frame.timeline * .7) * .025));
                    else bone.rotateX(sin(frame.timeline * 2.4) * .012 * frame.breath * attentiveWeight);
                }
            }
            applied = joints.length > 0;
        },
    };
}
