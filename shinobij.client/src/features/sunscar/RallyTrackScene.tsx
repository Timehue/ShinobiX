import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { rallyPath, rallySection } from '../../../../shared/sunscar/rally-tracks';
import { sunscarRandom } from '../../../../shared/sunscar/random';
import type { RallyTrack } from '../../../../shared/sunscar/rally-types';
import { RallyCrowd, RallyDunes } from './RallyEnvironment';
import { createCargoTexture, createSandTexture } from './rally-scenery';

function ribbon(track: RallyTrack): THREE.BufferGeometry {
    const positions: number[] = [], colors: number[] = [], indices: number[] = [], uv: number[] = [];
    const sand = new THREE.Color(track.palette.sand);
    const stone = new THREE.Color(track.palette.rock).lerp(new THREE.Color('#e4c6a2'), .4);
    const steps = Math.ceil((track.length + 70) / 8);
    for (let i = 0; i <= steps; i++) {
        const d = -20 + i * 8;
        const p = rallyPath(track, d);
        const s = rallySection(track, Math.max(0, d));
        const color = s.terrain === 'stone' || s.terrain === 'alley' ? stone : s.terrain === 'deep-sand' ? sand.clone().multiplyScalar(.85) : sand;
        for (const side of [-1, 1]) { positions.push(p.x + side * s.width / 2, p.y - .025, p.z); colors.push(color.r, color.g, color.b); uv.push(side * s.width / 8, d / 8); }
        if (i < steps) { const n = i * 2; indices.push(n, n + 1, n + 2, n + 1, n + 3, n + 2); }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return geometry;
}
function RouteScenery({ track }: { track: RallyTrack }) {
    const posts = useRef<THREE.InstancedMesh>(null);
    const rocks = useRef<THREE.InstancedMesh>(null);
    const shapes = useMemo(() => {
        const random = sunscarRandom(817);
        const markers: THREE.Matrix4[] = [], stones: THREE.Matrix4[] = [];
        const dummy = new THREE.Object3D();
        for (let d = 0; d < track.length + 40; d += 12) {
            const p = rallyPath(track, d);
            const width = rallySection(track, d).width;
            for (const side of [-1, 1]) {
                dummy.position.set(p.x + side * (width / 2 + .45), p.y + .45, p.z);
                dummy.rotation.set(0, 0, side * .06); dummy.scale.set(.15, .9, .15); dummy.updateMatrix(); markers.push(dummy.matrix.clone());
                const high = track.scenery === 'canyon' ? 6 + random() * 12 : 1 + random() * 5;
                dummy.position.set(p.x + side * (width / 2 + 6 + random() * 12), p.y + high * .25 - 1, p.z - random() * 8);
                dummy.rotation.set(random() * .5, random() * 6, random() * .4); dummy.scale.set(high * .7, high, high * .8); dummy.updateMatrix(); stones.push(dummy.matrix.clone());
            }
        }
        return { markers, stones };
    }, [track]);
    useEffect(() => {
        shapes.markers.forEach((m, i) => posts.current?.setMatrixAt(i, m));
        shapes.stones.forEach((m, i) => rocks.current?.setMatrixAt(i, m));
        if (posts.current) { posts.current.instanceMatrix.needsUpdate = true; posts.current.computeBoundingSphere(); }
        if (rocks.current) { rocks.current.instanceMatrix.needsUpdate = true; rocks.current.computeBoundingSphere(); }
    }, [shapes]);
    return <>
        <instancedMesh ref={posts} args={[undefined, undefined, shapes.markers.length]}><boxGeometry /><meshStandardMaterial color={track.palette.accent} roughness={1} /></instancedMesh>
        <instancedMesh ref={rocks} args={[undefined, undefined, shapes.stones.length]} castShadow receiveShadow><icosahedronGeometry args={[1, 1]} /><meshStandardMaterial color={track.palette.rock} roughness={1} /></instancedMesh>
    </>;
}
function Pavilion({ x, y, z, color }: { x: number; y: number; z: number; color: string }) {
    return <group position={[x, y, z]}>
        <mesh position={[0, 1, 0]}><boxGeometry args={[4, 2, 3]} /><meshStandardMaterial color="#ad815a" /></mesh>
        <mesh position={[0, 3.1, 0]} rotation={[0, Math.PI / 4, 0]}><coneGeometry args={[3.6, 2.3, 4]} /><meshStandardMaterial color={color} roughness={.9} /></mesh>
        <mesh position={[0, 4.7, 0]}><cylinderGeometry args={[.06, .06, 2, 6]} /><meshStandardMaterial color="#523e39" /></mesh>
        <mesh position={[.6, 5.1, 0]}><planeGeometry args={[1.2, .65]} /><meshStandardMaterial color="#f6d290" side={THREE.DoubleSide} /></mesh>
    </group>;
}
export function RallyTrackScene({ track }: { track: RallyTrack }) {
    const geometry = useMemo(() => ribbon(track), [track]);
    const texture = useMemo(() => createSandTexture(), []);
    const cargoTexture = useMemo(() => createCargoTexture(), []);
    useEffect(() => () => { geometry.dispose(); texture.dispose(); cargoTexture.dispose(); }, [geometry, texture, cargoTexture]);
    const finish = rallyPath(track, track.length);
    return <>
        <color attach="background" args={[track.palette.sky]} />
        <fog attach="fog" args={[track.palette.fog, 45, 175]} />
        <hemisphereLight args={['#c9d4d8', '#806b55', 1.25]} />
        <RallyDunes track={track}/>
        <mesh geometry={geometry} receiveShadow><meshStandardMaterial map={texture} vertexColors roughness={1} side={THREE.DoubleSide} /></mesh>
        <RouteScenery track={track} />
        <RallyCrowd track={track}/>
        {track.obstacles.map(o => {
            const p = rallyPath(track, o.at);
            const color = o.kind === 'shortcut' ? '#62d4b0' : o.kind === 'ramp' ? '#d9b177' : o.kind === 'rock' ? track.palette.rock : track.palette.accent;
            return <group key={o.id} position={[p.x + o.lane * 2.65, p.y, p.z]}>
                {o.kind === 'shortcut' ? <>
                    <mesh position={[0, .025, -13]} rotation={[-Math.PI / 2, 0, 0]}><planeGeometry args={[1.4, 26]} /><meshStandardMaterial color={color} emissive={color} emissiveIntensity={.14} /></mesh>
                    <mesh position={[0, 2.3, 0]}><torusGeometry args={[1.15, .085, 6, 18]} /><meshStandardMaterial color={color} emissive={color} emissiveIntensity={.5} /></mesh>
                </> : o.kind === 'ramp' ? <mesh position={[0, .32, -1.8]} rotation={[-.19, 0, 0]}><boxGeometry args={[1.9, .3, 5]} /><meshStandardMaterial color={color} /></mesh>
                    : o.kind === 'rock' ? <mesh position={[0, 1.7, 0]} scale={[1.1, 2, 1.3]}><dodecahedronGeometry /><meshStandardMaterial color={color} flatShading /></mesh>
                        : <>
                            <mesh position={[0, o.height / 2 + (o.kind === 'cart' ? .15 : 0), 0]} castShadow receiveShadow><boxGeometry args={[1.9, o.height - (o.kind === 'cart' ? .3 : 0), o.kind === 'cart' ? 2.4 : .45]} /><meshStandardMaterial map={cargoTexture} color={o.kind === 'cart' ? '#b98c58' : color} roughness={.9} /></mesh>
                            <mesh position={[0, o.height * .78, .24]}><boxGeometry args={[1.92, .16, .04]} /><meshStandardMaterial color="#f9d999" /></mesh>
                            {o.kind === 'cart' && <>
                                {[-.9, .9].flatMap(x => [-.8, .8].map(z => <mesh key={`${x}:${z}`} position={[x, .35, z]} rotation={[0, 0, Math.PI / 2]} castShadow><cylinderGeometry args={[.35, .35, .2, 10]} /><meshStandardMaterial color="#463932" /></mesh>))}
                                {[-.55, .55].map(x => <mesh key={x} position={[x, .95, 1.21]}><boxGeometry args={[.12, 1.3, .04]} /><meshStandardMaterial color="#5b4938" /></mesh>)}
                                <mesh position={[0, 1.09, 1.24]} rotation={[0, 0, Math.PI / 4]}><planeGeometry args={[.34, .34]}/><meshStandardMaterial color={track.palette.accent}/></mesh>
                            </>}
                        </>}
            </group>;
        })}
        {(track.scenery === 'festival' || track.scenery === 'market') && Array.from({ length: 16 }, (_, i) => {
            const p = rallyPath(track, i * track.length / 16 + 15);
            return <Pavilion key={i} x={p.x + (i % 2 ? -11 : 11)} y={p.y} z={p.z} color={i % 3 ? track.palette.accent : '#ddb879'} />;
        })}
        {[0, track.length].map(d => {
            const p = rallyPath(track, d);
            return <group key={d} position={[p.x, p.y, p.z]}>
                {[-6.4, 6.4].map(x => <mesh key={x} position={[x, 3, 0]}><boxGeometry args={[.45, 6, .45]} /><meshStandardMaterial color="#715444" /></mesh>)}
                <mesh position={[0, 5.5, 0]}><boxGeometry args={[13, 1, .15]} /><meshStandardMaterial color={track.palette.accent} /></mesh>
                {Array.from({ length: 12 }, (_, i) => <mesh key={i} rotation={[-Math.PI / 2, 0, 0]} position={[-5.5 + i, .045, 0]}><planeGeometry args={[1, 1.7]} /><meshStandardMaterial color={i % 2 ? '#51413a' : '#f3dfb6'} /></mesh>)}
            </group>;
        })}
        {[-1, 1].map(side => <group key={side} position={[finish.x + side * 13, finish.y, finish.z + 12]}>
            {[0, 1, 2].map(row => <mesh key={row} position={[side * row, row * .9 + .4, 0]}><boxGeometry args={[3, .8, 18]} /><meshStandardMaterial color="#a37652" /></mesh>)}
            <Pavilion x={side * 2} y={3} z={-8} color={track.palette.accent} />
        </group>)}
    </>;
}
