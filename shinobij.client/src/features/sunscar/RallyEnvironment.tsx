import { useEffect, useMemo, useRef, type RefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { RallyState, RallyTrack } from '../../../../shared/sunscar/rally-types';
import { rallyPath, rallySection } from '../../../../shared/sunscar/rally-tracks';
import { sunscarRandom } from '../../../../shared/sunscar/random';
import { createSandTexture } from './rally-scenery';
import { RALLY_CROWD_BAND, rallyCrowdSpots, rallyRoadHalfWidth } from './rally-layout';

function dunes(track: RallyTrack) {
    const positions: number[] = [], colors: number[] = [], uv: number[] = [], indices: number[] = [];
    const base = new THREE.Color(track.palette.sand), shade = new THREE.Color('#b49b74');
    const steps = Math.ceil((track.length + 180) / 10), cross = 28;
    for (let row = 0; row <= steps; row++) {
        const d = row * 10 - 70, p = rallyPath(track, d), width = rallySection(track, d).width;
        for (let col = 0; col <= cross; col++) {
            const column = col - cross / 2;
            // Explicit flat shoulder vertices keep a coarse dune triangle from
            // cutting across the road when a tall dune starts beside it.
            const x = column === 0 ? 0 : Math.sign(column) * (width / 2 + 2 + (Math.abs(column) - 1) * 12);
            const outside = Math.max(0, Math.abs(x) - width / 2 - 2);
            const waves = Math.sin(d * .031 + x * .044) * 2.7 + Math.cos(x * .032 - d * .027) * 2.4;
            const y = p.y - .1 + Math.min(1, outside / 16) * (waves + Math.min(11, outside * .07));
            positions.push(p.x + x, y, p.z); uv.push(x / 8, d / 8);
            const color = base.clone().lerp(shade, Math.max(0, .18 + Math.sin(d * .08 + x * .06) * .12));
            colors.push(color.r, color.g, color.b);
            if (row < steps && col < cross) { const a = row * (cross + 1) + col, b = a + cross + 1; indices.push(a, a + 1, b, a + 1, b + 1, b); }
        }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3)); geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geometry.setIndex(indices); geometry.computeVertexNormals(); return geometry;
}
export function RallyDunes({ track }: { track: RallyTrack }) {
    const surface = useMemo(() => ({ geometry: dunes(track), texture: createSandTexture() }), [track]);
    useEffect(() => () => { surface.geometry.dispose(); surface.texture.dispose(); }, [surface]);
    return <mesh geometry={surface.geometry} receiveShadow><meshStandardMaterial vertexColors map={surface.texture} roughness={1} side={THREE.DoubleSide}/></mesh>;
}
export function RallySun({ state }: { state: RefObject<RallyState> }) {
    const light = useRef<THREE.DirectionalLight>(null);
    const target = useMemo(() => new THREE.Object3D(), []);
    useFrame(() => {
        const p = rallyPath(rallyTrackFromState(state.current), state.current.racers[0].distance);
        if (light.current) { light.current.position.set(p.x - 24, p.y + 32, p.z - 16); target.position.set(p.x, p.y, p.z - 15); target.updateMatrixWorld(); }
    });
    return <><primitive object={target}/><directionalLight ref={light} target={target} intensity={2.1} color="#ffdfb1" castShadow shadow-mapSize={[1024, 1024]} shadow-camera-left={-28} shadow-camera-right={28} shadow-camera-top={35} shadow-camera-bottom={-25} shadow-camera-near={1} shadow-camera-far={110} shadow-bias={-.0005} shadow-normalBias={.035}/></>;
}
// Cache lookup is static; frames do not regenerate track or geometry.
import { rallyTrack as rallyTrackFromId } from '../../../../shared/sunscar/rally-tracks';
const rallyTrackFromState = (state: RallyState) => rallyTrackFromId(state.trackId);

export function RallyCrowd({ track }: { track: RallyTrack }) {
    const bodies = useRef<THREE.InstancedMesh>(null), heads = useRef<THREE.InstancedMesh>(null), flags = useRef<THREE.InstancedMesh>(null);
    const crowd = useMemo(() => {
        const random = sunscarRandom(382), dummy = new THREE.Object3D();
        const body: THREE.Matrix4[] = [], head: THREE.Matrix4[] = [], pennants: THREE.Matrix4[] = [], colors: THREE.Color[] = [];
        const { inner, depth, count, spacing } = RALLY_CROWD_BAND;
        for (const d of rallyCrowdSpots(track)) for (const side of [-1, 1]) for (let i = 0; i < count; i++) {
            const p = rallyPath(track, d + i * spacing), x = p.x + side * (rallyRoadHalfWidth(track, d + i * spacing) + inner + random() * depth);
            const tall = .85 + random() * .35;
            dummy.position.set(x, p.y + tall * .6, p.z); dummy.scale.set(.32, tall, .3); dummy.rotation.set(0, side * Math.PI / 2, 0); dummy.updateMatrix(); body.push(dummy.matrix.clone());
            dummy.position.y = p.y + tall * 1.35; dummy.scale.setScalar(.23); dummy.updateMatrix(); head.push(dummy.matrix.clone());
            colors.push(new THREE.Color(['#697d79', '#c29d65', '#985b49', '#434c57', '#9f8167'][i % 5]));
            if (i % 3 === 0) { dummy.position.set(x, p.y + tall * 1.9, p.z); dummy.rotation.set(0, Math.PI / 2, -.12); dummy.scale.set(.55, .32, 1); dummy.updateMatrix(); pennants.push(dummy.matrix.clone()); }
        }
        return { body, head, pennants, colors };
    }, [track]);
    useEffect(() => {
        crowd.body.forEach((m, i) => { bodies.current?.setMatrixAt(i, m); bodies.current?.setColorAt(i, crowd.colors[i]); });
        crowd.head.forEach((m, i) => heads.current?.setMatrixAt(i, m)); crowd.pennants.forEach((m, i) => flags.current?.setMatrixAt(i, m));
        for (const ref of [bodies, heads, flags]) if (ref.current) { ref.current.instanceMatrix.needsUpdate = true; ref.current.computeBoundingSphere(); if (ref.current.instanceColor) ref.current.instanceColor.needsUpdate = true; }
    }, [crowd]);
    return <><instancedMesh ref={bodies} args={[undefined, undefined, crowd.body.length]} castShadow><capsuleGeometry args={[.5, .55, 3, 6]}/><meshStandardMaterial roughness={1}/></instancedMesh><instancedMesh ref={heads} args={[undefined, undefined, crowd.head.length]}><sphereGeometry args={[1, 6, 4]}/><meshStandardMaterial color="#b29370" roughness={1}/></instancedMesh><instancedMesh ref={flags} args={[undefined, undefined, crowd.pennants.length]}><planeGeometry/><meshStandardMaterial color={track.palette.accent} side={THREE.DoubleSide}/></instancedMesh></>;
}
