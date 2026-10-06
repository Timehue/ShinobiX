import * as THREE from 'three';
import type { PetCombatMotion } from './pet-combat-performance';

type Joint = { bone: THREE.Bone; pose: THREE.Quaternion; rotationTrack: string; role: 'wing' | 'lower' | 'tip' | 'neck' | 'chest'; side: number; reach: number; offset: number; pairedGallop: boolean };
type RigMotionFrame = { motion: PetCombatMotion; timeline: number; delta: number; phase: number; galloping: boolean;
    locomotion: boolean; wingPhase: number | null; breath: number; lookYaw: number; contact: boolean; };
const canonical = (name: string) => name.replace(/[._]([LR])$/u, '$1');

/** Small skeletal secondary motions for the inspected roster topology.
 * No mesh deformation or limb guessing from a creature's presentation profile.
 * Save the mixer-produced pose and restore BEFORE its next evaluation: unkeyed
 * joints otherwise accumulate the delta and leak it into guard/KO/idle.
 * Detailed showcase takes retain their authored leg/head performances. */
export function createPetCombatRigMotion(scenes: readonly (THREE.Object3D | null)[], detailed = false) {
    const joints: Joint[] = [];
    for (const scene of scenes) {
        if (!scene) continue;
        const bones = new Map<string, THREE.Bone>();
        scene.traverse(node => { if (node instanceof THREE.Bone) bones.set(canonical(node.name), node); });
        const add = (bone: THREE.Bone, role: Joint['role'], side = 1, reach = 1, offset = 0, pairedGallop = false) =>
            joints.push({ bone, pose: bone.quaternion.clone(), rotationTrack: `${bone.name}.quaternion`, role, side, reach, offset, pairedGallop });
        for (const side of ['L', 'R']) {
            const upperWing = bones.get(`wing_upper${side}`), midWing = bones.get(`wing_mid${side}`);
            // Other wings (bat, moth, winged lion) have different axes/banks.
            if (upperWing && midWing?.parent === upperWing) { add(upperWing, 'wing', side === 'L' ? 1 : -1); add(midWing, 'wing', side === 'L' ? 1 : -1, .55); }
            if (detailed) continue;
            for (const [upperName, lowerName, tipName, offset] of [
                ['front_upper','front_lower','front_paw',0], ['hind_upper','hind_lower','hind_paw',.5], ['thigh','shin','foot',0],
            ] as const) {
                const upper = bones.get(upperName+side), lower = bones.get(lowerName+side), tip = bones.get(tipName+side);
                if (!upper || lower?.parent !== upper || tip?.parent !== lower) continue;
                // All thigh banks (biped, avian, bat) swing forward in the
                // opposite half-cycle from quadruped front-shoulder banks.
                // Bipeds keep alternating feet at speed; only quadruped banks
                // pair left/right forelegs and hindlegs through their gallop.
                const phaseOffset = offset + (upperName === 'thigh' ? .5 : 0), pairedGallop = upperName !== 'thigh';
                add(lower, 'lower', side === 'L' ? 1 : -1, 1, phaseOffset, pairedGallop);
                add(tip, 'tip', side === 'L' ? 1 : -1, 1, phaseOffset, pairedGallop);
            }
        }
        if (!detailed) {
            const neck = bones.get('neck'), head = bones.get('head'), chest = bones.get('chest');
            if (neck && head?.parent === neck) add(neck, 'neck');
            if (chest && neck?.parent === chest) add(chest, 'chest');
        }
    }
    const axisX = new THREE.Vector3(1,0,0), axisY = new THREE.Vector3(0,1,0), axisZ = new THREE.Vector3(0,0,1);
    const rotation = new THREE.Quaternion();
    const keyedJoints = new WeakMap<THREE.AnimationClip, Set<string>>();
    let applied = false, gaitWeight = 0, attentiveWeight = 0, look = 0;
    const restore = () => { if (!applied) return; for (const joint of joints) joint.bone.quaternion.copy(joint.pose); applied = false; };
    return {
        jointCount: joints.length,
        restore,
        reset: () => { restore(); gaitWeight = 0; attentiveWeight = 0; look = 0; },
        apply: (frame: RigMotionFrame, clip: THREE.AnimationClip | null) => {
            restore();
            let keyed = clip ? keyedJoints.get(clip) : undefined;
            if (clip && !keyed) { keyed = new Set(clip.tracks.map(track => track.name)); keyedJoints.set(clip, keyed); }
            const blend = 1 - Math.exp(-Math.max(0, frame.delta) * 12);
            const neutral = frame.motion === 'idle' || frame.motion === 'guard' || frame.motion === 'rest';
            // Contact/KO owns its exact authored silhouette, including hit-stop.
            const committed = frame.contact || frame.motion === 'dead' || frame.motion === 'stagger';
            gaitWeight = committed ? 0 : THREE.MathUtils.lerp(gaitWeight, frame.locomotion ? 1 : 0, blend);
            attentiveWeight = committed ? 0 : THREE.MathUtils.lerp(attentiveWeight, neutral ? 1 : 0, blend);
            const lookError = Math.atan2(Math.sin(frame.lookYaw), Math.cos(frame.lookYaw));
            look = THREE.MathUtils.lerp(look, THREE.MathUtils.clamp(lookError, -.16, .16), blend);
            for (const joint of joints) {
                joint.pose.copy(joint.bone.quaternion);
                if (joint.role === 'wing') {
                    if (frame.wingPhase === null || committed) continue;
                    // Current feather weights tolerate a restrained fold; the
                    // former >1 radian drive sheared their layered wing tips.
                    // Land unkeyed middle wings before the clip changes. A
                    // terminal offset otherwise snaps off on return to idle.
                    const phase = THREE.MathUtils.clamp(frame.wingPhase, 0, 1);
                    const envelope = THREE.MathUtils.smoothstep(phase, 0, .12) * (1 - THREE.MathUtils.smoothstep(phase, .78, 1));
                    const spread = (.22 + (.5 + Math.sin(phase * Math.PI * 3.2) * .5) * .44) * envelope;
                    joint.bone.quaternion.multiply(rotation.setFromAxisAngle(axisX, joint.side * spread * joint.reach));
                    joint.bone.quaternion.multiply(rotation.setFromAxisAngle(axisZ, joint.side * .08 * joint.reach * Math.sin(Math.PI * phase) * envelope));
                } else if (joint.role === 'lower' || joint.role === 'tip') {
                    // Supplement only unkeyed distal joints. Imported authored
                    // knee/ankle curves always win over this recovery layer.
                    if (gaitWeight === 0 || keyed?.has(joint.rotationTrack)) continue;
                    const sideOffset = frame.galloping && joint.pairedGallop ? 0 : joint.side < 0 ? .5 : 0;
                    const swing = Math.max(0, Math.sin((frame.phase + joint.offset + sideOffset + .5) * Math.PI * 2));
                    const flex = swing * swing * gaitWeight * (frame.galloping ? .42 : .28);
                    joint.bone.quaternion.multiply(rotation.setFromAxisAngle(axisX, flex * (joint.role === 'lower' ? -1 : .65)));
                } else if (joint.role === 'neck') {
                    if (attentiveWeight === 0) continue;
                    // The authored head take remains intact; neck attention is
                    // restrained and driven by the same slowed combat clock.
                    joint.bone.quaternion.multiply(rotation.setFromAxisAngle(axisY, attentiveWeight * (look + Math.sin(frame.timeline * .7) * .025)));
                } else {
                    if (attentiveWeight === 0) continue;
                    joint.bone.quaternion.multiply(rotation.setFromAxisAngle(axisX, Math.sin(frame.timeline * 2.4) * .012 * frame.breath * attentiveWeight));
                }
            }
            applied = joints.length > 0;
        },
    };
}
