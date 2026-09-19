import { useRef, type RefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { RallyState } from '../../../../shared/sunscar/rally-types';
import { rallyPetPosition } from './rally-presentation';

const colors = { Fire: '#ff9b44', Lightning: '#d4baff', Wind: '#bcebdd', Earth: '#d4b77f', Water: '#6ad8f1' };
export function RallyPetEffects({ state, index, color, light, reducedMotion }: { state: RefObject<RallyState>; index: number; color: string; light: boolean; reducedMotion: boolean }) {
    const group = useRef<THREE.Group>(null), aura = useRef<THREE.Group>(null), particles = useRef<THREE.InstancedMesh>(null), marker = useRef<THREE.Mesh>(null), charge = useRef<THREE.Mesh>(null);
    const dummy = useRef(new THREE.Object3D());
    const finishTarget = useRef(new THREE.Vector3());
    const element = state.current.racers[index].pet.element;
    useFrame((_, delta) => {
        const race = state.current, racer = race.racers[index], p = rallyPetPosition(race, index);
        if (!group.current || !aura.current || !particles.current) return;
        const gap = racer.distance - race.racers[0].distance;
        group.current.visible = race.finished || index === 0 || gap > -24 && gap < 175;
        if (!group.current.visible) return;
        if (race.finished) group.current.position.lerp(finishTarget.current.set(p.x, p.y + .035, p.z), reducedMotion ? 1 : 1 - Math.exp(-Math.min(delta, .1) * 5));
        else group.current.position.set(p.x, p.y + .035, p.z);
        if (marker.current) {
            const impact = race.events.findLast(e => e.targetId === racer.id && race.tick - e.tick < 30);
            marker.current.scale.setScalar(impact ? 1.35 : 1 + racer.jump * .08);
            const material = marker.current.material as THREE.MeshBasicMaterial;
            material.opacity = impact ? .9 : (index === 0 ? .65 : .2) / (1 + racer.jump * .4);
            material.color.set(impact?.kind === 'shot-hit' ? '#ff8876' : impact?.kind === 'shot-blocked' ? '#9dc9ff' : impact?.kind === 'shot-dodged' ? '#81edbd' : color);
        }
        const active = racer.techniqueTicks > 0 || racer.armor || racer.recoilTicks > 0;
        aura.current.visible = active;
        aura.current.position.y = racer.jump + .7;
        aura.current.rotation.y = race.tick * .018;
        if (charge.current) {
            charge.current.visible = racer.finishTick === null && racer.attackCharge > 5;
            charge.current.position.y = racer.jump + 1.25;
            charge.current.scale.setScalar(.08 + racer.attackCharge / 100 * .2 + (racer.attackCharge >= 100 ? Math.sin(race.tick * .12) * .025 : 0));
        }
        particles.current.visible = racer.finishTick === null && (active || racer.burst && racer.stamina > 0 && !racer.stagger);
        if (!particles.current.visible) return;
        const count = light ? 8 : 24;
        particles.current.count = count;
        for (let i = 0; i < count; i++) {
            const t = (i / count + race.tick / 85) % 1;
            const spread = (element === 'Earth' ? 1.1 : .7) * (1 + t * .5);
            dummy.current.position.set(Math.sin(i * 19 + race.tick * .03) * spread, racer.jump + .15 + t * (element === 'Fire' ? 1.9 : .75), .2 + t * 3);
            dummy.current.rotation.set(t * 8, t * 13, 0); dummy.current.scale.setScalar((1 - t) * (active ? .085 : .04)); dummy.current.updateMatrix(); particles.current.setMatrixAt(i, dummy.current.matrix);
        }
        particles.current.instanceMatrix.needsUpdate = true;
    });
    return <group ref={group}>
        <mesh ref={charge} position={[0, 1.25, -.85]} visible={false}><octahedronGeometry args={[1, 0]}/><meshBasicMaterial color={colors[element]} toneMapped={false}/></mesh>
        <mesh ref={marker} rotation={[-Math.PI / 2, 0, 0]}><ringGeometry args={[index === 0 ? .85 : .65, index === 0 ? .91 : .69, 32]}/><meshBasicMaterial color={color} transparent opacity={.6} depthWrite={false}/></mesh>
        <group ref={aura} visible={false}>{[0, 1].map(i => <mesh key={i} rotation={[Math.PI / 2 + i * .6, i * .8, 0]}><torusGeometry args={[1 + i * .18, element === 'Earth' ? .09 : .025, 5, element === 'Lightning' ? 7 : 32]}/><meshBasicMaterial color={colors[element]} transparent opacity={element === 'Water' ? .36 : .55} depthWrite={false}/></mesh>)}</group>
        <instancedMesh ref={particles} args={[undefined, undefined, 24]} frustumCulled={false}><octahedronGeometry args={[1, 0]}/><meshBasicMaterial color={colors[element]} transparent opacity={.65} depthWrite={false}/></instancedMesh>
    </group>;
}
