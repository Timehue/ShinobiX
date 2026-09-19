import { useRef, type RefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { RallyState } from '../../../../shared/sunscar/rally-types';
import { rallyShotTarget } from '../../../../shared/sunscar/rally-combat';
import { rallyPath, rallyTrack } from '../../../../shared/sunscar/rally-tracks';

export function RallyAimGuide({ state }: { state: RefObject<RallyState> }) {
    const ring = useRef<THREE.Mesh>(null);
    useFrame(() => {
        if (!ring.current) return;
        const race = state.current, player = race.racers[0];
        const target = player.attackCharge >= 100 && !player.stagger ? rallyShotTarget(race, player) : undefined;
        ring.current.visible = !!target && !race.finished;
        if (!target) return;
        const p = rallyPath(rallyTrack(race.trackId), target.distance);
        ring.current.position.set(p.x + target.lane * 2.65, p.y + .055, p.z);
        (ring.current.material as THREE.MeshBasicMaterial).color.set(target.armor || target.shieldTicks > 0 ? '#a6ccff' : '#ffcf6e');
    });
    return <mesh ref={ring} visible={false} rotation={[-Math.PI / 2, 0, 0]}><ringGeometry args={[1.15, 1.25, 24]}/><meshBasicMaterial transparent opacity={.9} depthWrite={false}/></mesh>;
}
