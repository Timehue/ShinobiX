import { useRef, type RefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { RallyState } from '../../../../shared/sunscar/rally-types';
import { rallyPetPosition } from './rally-presentation';

const colors = { Fire: '#ff9b44', Lightning: '#d4baff', Wind: '#bcebdd', Earth: '#d4b77f', Water: '#6ad8f1' };
export function RallyPetEffects({ state, index, color }: { state: RefObject<RallyState>; index: number; color: string }) {
    const group = useRef<THREE.Group>(null), aura = useRef<THREE.Group>(null), particles = useRef<THREE.InstancedMesh>(null), marker = useRef<THREE.Mesh>(null);
    const dummy = useRef(new THREE.Object3D());
    const finishTarget = useRef(new THREE.Vector3());
    const element = state.current.racers[index].pet.element;
    useFrame((_, delta) => {
        const race = state.current, racer = race.racers[index], p = rallyPetPosition(race, index);
        if (!group.current || !aura.current || !particles.current) return;
        if (race.finished) group.current.position.lerp(finishTarget.current.set(p.x, p.y + .035, p.z), 1 - Math.exp(-Math.min(delta, .1) * 5));
        else group.current.position.set(p.x, p.y + .035, p.z);
        if (marker.current) { marker.current.scale.setScalar(1 + racer.jump * .08); (marker.current.material as THREE.MeshBasicMaterial).opacity = (index === 0 ? .65 : .2) / (1 + racer.jump * .4); }
        const active = racer.techniqueTicks > 0 || racer.armor;
        aura.current.visible = active;
        aura.current.position.y = racer.jump + .7;
        aura.current.rotation.y = race.tick * .018;
        particles.current.visible = active || racer.burst && racer.stamina > 0;
        for (let i = 0; i < 24; i++) {
            const t = (i / 24 + race.tick / 85) % 1;
            const spread = (element === 'Earth' ? 1.1 : .7) * (1 + t * .5);
            dummy.current.position.set(Math.sin(i * 19 + race.tick * .03) * spread, racer.jump + .15 + t * (element === 'Fire' ? 1.9 : .75), .2 + t * 3);
            dummy.current.rotation.set(t * 8, t * 13, 0); dummy.current.scale.setScalar((1 - t) * (active ? .085 : .04)); dummy.current.updateMatrix(); particles.current.setMatrixAt(i, dummy.current.matrix);
        }
        particles.current.instanceMatrix.needsUpdate = true;
    });
    return <group ref={group}>
        <mesh ref={marker} rotation={[-Math.PI / 2, 0, 0]}><ringGeometry args={[index === 0 ? .85 : .65, index === 0 ? .91 : .69, 32]}/><meshBasicMaterial color={color} transparent opacity={.6} depthWrite={false}/></mesh>
        <group ref={aura} visible={false}>{[0, 1].map(i => <mesh key={i} rotation={[Math.PI / 2 + i * .6, i * .8, 0]}><torusGeometry args={[1 + i * .18, element === 'Earth' ? .09 : .025, 5, element === 'Lightning' ? 7 : 32]}/><meshBasicMaterial color={colors[element]} transparent opacity={element === 'Water' ? .36 : .55} depthWrite={false}/></mesh>)}</group>
        <instancedMesh ref={particles} args={[undefined, undefined, 24]} frustumCulled={false}><octahedronGeometry args={[1, 0]}/><meshBasicMaterial color={colors[element]} transparent opacity={.65} depthWrite={false}/></instancedMesh>
    </group>;
}
