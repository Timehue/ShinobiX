import { useMemo, useRef, type RefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { RallyState } from '../../../../shared/sunscar/rally-types';
import { rallyPath, rallyTrack } from '../../../../shared/sunscar/rally-tracks';
import { RALLY_TECHNIQUES } from '../../../../shared/sunscar/rally-profiles';

/** Four pooled projectiles: no React updates or extra lights per shot. */
export function RallyShotEffects({ state }: { state: RefObject<RallyState> }) {
    const bolts = useRef<THREE.InstancedMesh>(null);
    const dummy = useMemo(() => new THREE.Object3D(), []);
    const colors = useMemo(() => Object.fromEntries(Object.entries(RALLY_TECHNIQUES).map(([key, value]) => [key, new THREE.Color(value.color)])), []);
    useFrame(() => {
        if (!bolts.current) return;
        const race = state.current;
        bolts.current.count = race.finished ? 0 : race.shots.length;
        if (!bolts.current.count) return;
        const track = rallyTrack(race.trackId);
        for (let i = 0; i < race.shots.length; i++) {
            const shot = race.shots[i], path = rallyPath(track, shot.distance);
            dummy.position.set(path.x + shot.lane * 2.65, path.y + .85, path.z);
            dummy.scale.set(shot.width * .65, .2, shot.element === 'Lightning' ? 1.2 : shot.element === 'Earth' ? .4 : .85); dummy.updateMatrix();
            bolts.current.setMatrixAt(i, dummy.matrix);
            bolts.current.setColorAt(i, colors[shot.element]);
        }
        bolts.current.instanceMatrix.needsUpdate = true;
        if (bolts.current.instanceColor) bolts.current.instanceColor.needsUpdate = true;
    });
    return <instancedMesh ref={bolts} args={[undefined, undefined, 4]} frustumCulled={false}>
        <sphereGeometry args={[1, 8, 6]}/><meshBasicMaterial toneMapped={false}/>
    </instancedMesh>;
}
