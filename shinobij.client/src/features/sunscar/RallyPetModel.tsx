import { useEffect, useMemo, useRef, type RefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { RallyState } from '../../../../shared/sunscar/rally-types';
import { rallyPath, rallyTrack } from '../../../../shared/sunscar/rally-tracks';
import type { Pet } from '../../types/pet';
import { petCombatModel } from '../../lib/pet-3d-models';
import { warfrontPetModelConfig } from '../../lib/pet-warfront-model-lod';
import { stablePetModelPresentationBounds } from '../../lib/pet-model-bounds';
import { bindPetAtlasTexture, copyPetAtlasSampling } from '../../lib/pet-atlas-material';
import { preloadPetGlbAtlas, readPetGlbAtlas } from '../../lib/pet-glb-atlas';
import { disposePetModelResources } from '../../lib/pet-model-resources';
import { INDIVIDUAL_PET_ANIMATION_MODEL_IDS } from '../../lib/pet-proper-animation-assets';
import { prepareRallyClips, RALLY_CLIP_MAP, rallyClipSpeed, rallyBodyPose, rallyAnimationDelta, rallyJumpPhase, rallyWaitingMotion } from './rally-animation';
import { rallyPetPosition } from './rally-presentation';
import { createRallyRigPose } from './rally-rig-pose';

export function RallyPetModel({ state, index, onReady, reducedMotion, moving }: { state: RefObject<RallyState>; index: number; onReady: (id: string) => void; reducedMotion: boolean; moving: RefObject<boolean> }) {
    const pet = state.current.racers[index].pet;
    const config = useMemo(() => {
        const selected = warfrontPetModelConfig(petCombatModel(pet as unknown as Pet));
        if (!selected) throw new Error('No approved 3D model exists for this pet.');
        return selected;
    }, [pet]);
    // Start both resource readers before either suspends. FileLoader then
    // shares one in-flight GLB; reading the atlas after useGLTF alone downloaded
    // the same model again when HTTP caching was unavailable.
    void preloadPetGlbAtlas(config.url);
    const gltf = useGLTF(config.url);
    const atlas = readPetGlbAtlas(config.url);
    const actor = useRef<THREE.Group>(null);
    const body = useRef<THREE.Group>(null);
    const stride = useRef<THREE.Group>(null);
    const finishTarget = useMemo(() => new THREE.Vector3(), []);
    const prepared = useMemo(() => {
        const scene = clone(gltf.scene) as THREE.Group;
        const materials: THREE.Material[] = [];
        let skinned = 0;
        scene.traverse(node => {
            if (!(node instanceof THREE.Mesh)) return;
            if (node instanceof THREE.SkinnedMesh) skinned++;
            node.castShadow = true;
            node.frustumCulled = false;
            const convert = (original: THREE.Material) => {
                const material = original.clone();
                if (material instanceof THREE.MeshStandardMaterial) {
                    if (atlas) material.map = copyPetAtlasSampling(atlas, material.map);
                    if (material.map) bindPetAtlasTexture(material.map, 2);
                    material.roughness = Math.max(.6, material.roughness);
                    material.metalness = Math.min(.25, material.metalness);
                }
                materials.push(material);
                return material;
            };
            node.material = Array.isArray(node.material) ? node.material.map(convert) : convert(node.material);
        });
        if (!skinned) throw new Error('This companion has no usable skinning.');
        const bank = prepareRallyClips(gltf.animations, scene, reducedMotion, INDIVIDUAL_PET_ANIMATION_MODEL_IDS.has(config.visualId));
        const mixer = new THREE.AnimationMixer(scene);
        mixer.clipAction(bank.get('idle')!).play();
        mixer.update(.01);
        const bounds = stablePetModelPresentationBounds(scene);
        const size = bounds.fit.getSize(new THREE.Vector3());
        const center = bounds.fit.getCenter(new THREE.Vector3());
        const scale = Math.min(1.75 / Math.max(.01, size.y), 2.8 / Math.max(.01, size.x, size.z));
        mixer.stopAllAction();
        const pose = createRallyRigPose(scene, bank, INDIVIDUAL_PET_ANIMATION_MODEL_IDS.has(config.visualId));
        return { scene, materials, bank, mixer, pose, scale, offset: [-center.x, -bounds.groundY, -center.z] as [number, number, number] };
    }, [gltf, atlas, reducedMotion, config.visualId]);
    const animation = useRef<{ name: string; action: THREE.AnimationAction | null }>({ name: '', action: null });
    useEffect(() => {
        animation.current = { name: '', action: null };
        return () => {
            prepared.mixer.stopAllAction();
            prepared.mixer.uncacheRoot(prepared.scene);
            disposePetModelResources({ surface: prepared.scene, outline: null, materials: prepared.materials });
        };
    }, [prepared]);
    const ready = useRef(false);
    useFrame((_, delta) => {
        const race = state.current;
        const racer = race.racers[index];
        const motion = rallyWaitingMotion(racer.motion, racer.finishTick, race.finished);
        if (!actor.current) return;
        const gap = racer.distance - race.racers[0].distance;
        actor.current.visible = race.finished || index === 0 || gap > -24 && gap < 175;
        if (!actor.current.visible && ready.current) return;
        const path = rallyPath(rallyTrack(race.trackId), racer.distance);
        const position = rallyPetPosition(race, index);
        // Reduced motion jumps straight to the podium pose instead of gliding.
        const settle = reducedMotion ? 1 : 1 - Math.exp(-Math.min(delta, .1) * 5);
        finishTarget.set(position.x, position.y + (racer.finishTick !== null ? 0 : racer.jump), position.z);
        if (race.finished) actor.current.position.lerp(finishTarget, settle);
        else actor.current.position.copy(finishTarget);
        const ahead = rallyPath(rallyTrack(race.trackId), racer.distance + .5);
        const facing = race.finished ? config.yawOffset : Math.PI + config.yawOffset - Math.atan2(ahead.x - path.x, .5);
        actor.current.rotation.y = race.finished ? THREE.MathUtils.lerp(actor.current.rotation.y, facing, settle) : facing;
        if (body.current) {
            const pose = rallyBodyPose(motion, racer.targetLane - racer.lane, racer.verticalSpeed, racer.recoilTicks, reducedMotion);
            const blend = 1 - Math.exp(-Math.min(delta, .1) * 18);
            body.current.rotation.z = THREE.MathUtils.lerp(body.current.rotation.z, pose.bank, blend);
            body.current.rotation.x = THREE.MathUtils.lerp(body.current.rotation.x, pose.pitch, blend);
            body.current.scale.y = THREE.MathUtils.lerp(body.current.scale.y, pose.squash, blend);
        }
        const name = RALLY_CLIP_MAP[motion];
        const current = animation.current;
        prepared.pose.restoreStride();
        if (current.name !== name) {
            const next = prepared.mixer.clipAction(prepared.bank.get(name)!);
            next.reset().setEffectiveWeight(1).setEffectiveTimeScale(1).play();
            next.setLoop(['victory', 'idle_hitreact1', 'gallop_jump'].includes(name) ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
            next.clampWhenFinished = true;
            if (current.action && current.action !== next) current.action.crossFadeTo(next, .14, false);
            current.name = name;
            current.action = next;
        }
        if (current.action) {
            current.action.paused = false;
            current.action.setEffectiveTimeScale(rallyClipSpeed(motion, racer.speed));
            const jumpPhase = rallyJumpPhase(motion, racer.verticalSpeed, racer.landing);
            if (jumpPhase !== null) {
                current.action.time = current.action.getClip().duration * jumpPhase;
                current.action.paused = true;
            }
        }
        prepared.mixer.update(rallyAnimationDelta(delta, moving.current, motion === 'ready', race.finished));
        if (stride.current) {
            stride.current.rotation.z = !reducedMotion && name === 'gallop' && current.action
                ? prepared.pose.applyStride(current.action.time / current.action.getClip().duration) : 0;
        }
        if (body.current) {
            if (race.finished) body.current.position.y = 0;
            else prepared.pose.ground(body.current, actor.current);
        }
        if (!ready.current) { ready.current = true; onReady(racer.id); }
    });
    return <group ref={actor}>
        <group ref={body}><group ref={stride} scale={prepared.scale}><primitive object={prepared.scene} position={prepared.offset} dispose={null} /></group></group>
    </group>;
}
