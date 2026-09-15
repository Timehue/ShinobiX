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
import { readPetGlbAtlas } from '../../lib/pet-glb-atlas';
import { disposePetModelResources } from '../../lib/pet-model-resources';
import { prepareRallyClips, RALLY_CLIP_MAP, rallyClipSpeed } from './rally-animation';
import { rallyPetPosition } from './rally-presentation';

export function RallyPetModel({ state, index, onReady }: { state: RefObject<RallyState>; index: number; onReady: (id: string) => void }) {
    const pet = state.current.racers[index].pet;
    const config = useMemo(() => {
        const selected = warfrontPetModelConfig(petCombatModel(pet as unknown as Pet));
        if (!selected) throw new Error('No approved 3D model exists for this pet.');
        return selected;
    }, [pet]);
    const gltf = useGLTF(config.url);
    const atlas = readPetGlbAtlas(config.url);
    const actor = useRef<THREE.Group>(null);
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
        const bank = prepareRallyClips(gltf.animations);
        const mixer = new THREE.AnimationMixer(scene);
        mixer.clipAction(bank.get('idle')!).play();
        mixer.update(.01);
        const bounds = stablePetModelPresentationBounds(scene);
        const size = bounds.fit.getSize(new THREE.Vector3());
        const center = bounds.fit.getCenter(new THREE.Vector3());
        const scale = Math.min(1.75 / Math.max(.01, size.y), 2.8 / Math.max(.01, size.x, size.z));
        mixer.stopAllAction();
        return { scene, materials, bank, mixer, scale, offset: [-center.x, -bounds.groundY, -center.z] as [number, number, number] };
    }, [gltf, atlas]);
    const animation = useRef<{ name: string; action: THREE.AnimationAction | null; phase: string }>({ name: '', action: null, phase: '' });
    useEffect(() => {
        animation.current = { name: '', action: null, phase: '' };
        return () => {
            prepared.mixer.stopAllAction();
            prepared.mixer.uncacheRoot(prepared.scene);
            disposePetModelResources({ surface: prepared.scene, outline: null, materials: prepared.materials });
        };
    }, [prepared]);
    const ready = useRef(false);
    const lastTick = useRef(-1);
    useFrame((_, delta) => {
        const race = state.current;
        const racer = race.racers[index];
        if (!actor.current) return;
        const path = rallyPath(rallyTrack(race.trackId), racer.distance);
        const position = rallyPetPosition(race, index);
        if (race.finished) actor.current.position.lerp(finishTarget.set(position.x, position.y, position.z), 1 - Math.exp(-Math.min(delta, .1) * 5));
        else actor.current.position.set(position.x, position.y + racer.jump, position.z);
        const ahead = rallyPath(rallyTrack(race.trackId), racer.distance + .5);
        const facing = race.finished ? config.yawOffset : Math.PI + config.yawOffset - Math.atan2(ahead.x - path.x, .5);
        actor.current.rotation.y = race.finished ? THREE.MathUtils.lerp(actor.current.rotation.y, facing, 1 - Math.exp(-Math.min(delta, .1) * 5)) : facing;
        const name = RALLY_CLIP_MAP[racer.motion];
        const current = animation.current;
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
            current.action.setEffectiveTimeScale(rallyClipSpeed(racer.motion, racer.speed));
            if (racer.motion === 'airborne') {
                current.action.time = current.action.getClip().duration * .5;
                current.action.paused = true;
            } else if (racer.motion === 'land' && current.phase !== 'land') current.action.time = current.action.getClip().duration * .74;
            current.phase = racer.motion;
        }
        prepared.mixer.update(lastTick.current !== race.tick || racer.motion === 'ready' || race.finished ? Math.min(delta, .05) : 0);
        lastTick.current = race.tick;
        if (!ready.current) { ready.current = true; onReady(racer.id); }
    });
    return <group ref={actor}>
        <group scale={prepared.scale}><primitive object={prepared.scene} position={prepared.offset} dispose={null} /></group>
    </group>;
}
