import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { rallyLanePosition, rallyPath, rallyPathFrame, rallySection } from '../../../../shared/sunscar/rally-tracks';
import type { RallyTrack } from '../../../../shared/sunscar/rally-types';
import { RallyCrowd, RallyDunes } from './RallyEnvironment';
import { createCargoTexture, createSandTexture } from './rally-scenery';
import { RALLY_RIBBON_START, RALLY_RIBBON_STEP, rallyArch, rallyGrandstands, rallyPavilions, rallyRoadHalfWidth, rallyRocks } from './rally-layout';
import { RallyRouteMarkings } from './RallyRouteMarkings';

function ribbon(track: RallyTrack): THREE.BufferGeometry {
    const positions: number[] = [], colors: number[] = [], indices: number[] = [], uv: number[] = [];
    const sand = new THREE.Color(track.palette.sand);
    const stone = new THREE.Color(track.palette.rock).lerp(new THREE.Color('#e4c6a2'), .4);
    const steps = Math.ceil((track.length + 70) / RALLY_RIBBON_STEP);
    for (let i = 0; i <= steps; i++) {
        const d = RALLY_RIBBON_START + i * RALLY_RIBBON_STEP;
        const p = rallyPath(track, d);
        const s = rallySection(track, Math.max(0, d));
        const color = s.terrain === 'stone' || s.terrain === 'alley' ? stone : s.terrain === 'deep-sand' ? sand.clone().multiplyScalar(.85) : sand;
        const frame = rallyPathFrame(track, d);
        for (const side of [-1, 1]) { positions.push(p.x + frame.rightX * side * s.width / 2, p.y - .025, p.z + frame.rightZ * side * s.width / 2); colors.push(color.r, color.g, color.b); uv.push(side * s.width / 8, d / 8); }
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
function RouteScenery({ track, light }: { track: RallyTrack; light: boolean }) {
    const posts = useRef<THREE.InstancedMesh>(null);
    const pennants = useRef<THREE.InstancedMesh>(null);
    const rocks = useRef<THREE.InstancedMesh>(null);
    const shapes = useMemo(() => {
        const markers: THREE.Matrix4[] = [], flags: THREE.Matrix4[] = [], flagColors: THREE.Color[] = [], stones: THREE.Matrix4[] = [];
        const dummy = new THREE.Object3D();
        for (let d = 0; d < track.length + 40; d += light ? 24 : 12) {
            const p = rallyPath(track, d);
            const half = rallyRoadHalfWidth(track, d);
            const frame = rallyPathFrame(track, d);
            for (const side of [-1, 1]) {
                const point = rallyLanePosition(track, d, side * (half + .45));
                dummy.position.set(point.x, p.y + .45, point.z);
                dummy.rotation.set(0, frame.yaw, side * .06); dummy.scale.set(.15, .9, .15); dummy.updateMatrix(); markers.push(dummy.matrix.clone());
                if ((d / (light ? 24 : 12)) % 2 === 0) {
                    dummy.position.set(point.x, p.y + 1.06, point.z);
                    dummy.rotation.set(0, frame.yaw, 0); dummy.scale.set(.82, .72, 1); dummy.updateMatrix(); flags.push(dummy.matrix.clone());
                    flagColors.push(new THREE.Color(flagColors.length % 2 ? '#e4bd78' : track.palette.accent));
                }
            }
        }
        for (const rock of rallyRocks(track).filter((_, i) => !light || i % 2 === 0)) {
            dummy.position.set(...rock.position); dummy.rotation.set(...rock.rotation); dummy.scale.set(...rock.scale);
            dummy.updateMatrix(); stones.push(dummy.matrix.clone());
        }
        return { markers, flags, flagColors, stones };
    }, [track, light]);
    useEffect(() => {
        shapes.markers.forEach((m, i) => posts.current?.setMatrixAt(i, m));
        shapes.flags.forEach((m, i) => { pennants.current?.setMatrixAt(i, m); pennants.current?.setColorAt(i, shapes.flagColors[i]); });
        shapes.stones.forEach((m, i) => rocks.current?.setMatrixAt(i, m));
        if (posts.current) { posts.current.instanceMatrix.needsUpdate = true; posts.current.computeBoundingSphere(); }
        if (pennants.current) { pennants.current.instanceMatrix.needsUpdate = true; pennants.current.instanceColor!.needsUpdate = true; pennants.current.computeBoundingSphere(); }
        if (rocks.current) { rocks.current.instanceMatrix.needsUpdate = true; rocks.current.computeBoundingSphere(); }
    }, [shapes]);
    return <>
        <instancedMesh ref={posts} args={[undefined, undefined, shapes.markers.length]}><boxGeometry /><meshStandardMaterial color={track.palette.accent} roughness={1} /></instancedMesh>
        <instancedMesh ref={pennants} args={[undefined, undefined, shapes.flags.length]}><planeGeometry args={[1, 1]} /><meshStandardMaterial color="#ffffff" side={THREE.DoubleSide} roughness={.82} /></instancedMesh>
        <instancedMesh ref={rocks} args={[undefined, undefined, shapes.stones.length]} castShadow={!light} receiveShadow={!light}><icosahedronGeometry args={[1, light ? 0 : 1]} /><meshStandardMaterial color={track.palette.rock} roughness={1} /></instancedMesh>
    </>;
}
function Pavilion({ x, y, z, color, yaw = 0, light = false }: { x: number; y: number; z: number; color: string; yaw?: number; light?: boolean }) {
    return <group position={[x, y, z]} rotation={[0, yaw, 0]}>
        <mesh position={[0, .24, 0]} castShadow receiveShadow><boxGeometry args={[3.6, .32, 2.8]} /><meshStandardMaterial color="#75513d" roughness={.94} /></mesh>
        {[-1, 1].flatMap(sx => (light ? [0] : [-1, 1]).map(sz => <mesh key={`${sx}:${sz}`} position={[sx * 1.45, 1.08, sz * 1.05]} castShadow={!light}>
            <cylinderGeometry args={[.095, .14, 1.85, 8]} /><meshStandardMaterial color="#c69b67" roughness={.88} />
        </mesh>))}
        {!light && <mesh position={[0, 1.65, 0]}><boxGeometry args={[4.1, .22, 3.35]} /><meshStandardMaterial color={color} roughness={.86} /></mesh>}
        <mesh position={[0, 2.3, 0]} rotation={[0, Math.PI / 4, 0]} castShadow><coneGeometry args={[2.75, 1.35, 4]} /><meshStandardMaterial color={color} roughness={.9} /></mesh>
        {!light && <>
            <mesh position={[0, .92, 1.43]}><boxGeometry args={[1.5, .75, .12]} /><meshStandardMaterial color="#a7774c" roughness={.92} /></mesh>
            <mesh position={[0, 1.17, 1.51]}><planeGeometry args={[.9, .36]} /><meshStandardMaterial color="#f4d99d" emissive="#c18b4e" emissiveIntensity={.12} side={THREE.DoubleSide} /></mesh>
            {[-.65, .65].map(x => <mesh key={x} position={[x, 1.55, 1.45]}><sphereGeometry args={[.12, 8, 6]} /><meshStandardMaterial color="#ffd788" emissive="#e39a50" emissiveIntensity={.7} /></mesh>)}
        </>}
    </group>;
}
export function RallyTrackScene({ track, light }: { track: RallyTrack; light: boolean }) {
    const geometry = useMemo(() => ribbon(track), [track]);
    const texture = useMemo(() => createSandTexture(), []);
    const cargoTexture = useMemo(() => createCargoTexture(), []);
    useEffect(() => () => { geometry.dispose(); texture.dispose(); cargoTexture.dispose(); }, [geometry, texture, cargoTexture]);
    return <>
        <color attach="background" args={[track.palette.sky]} />
        <fog attach="fog" args={[track.palette.fog, 45, light ? 125 : 175]} />
        <hemisphereLight args={['#c9d4d8', '#806b55', 1.25]} />
        <RallyDunes track={track} light={light}/>
        <mesh geometry={geometry} receiveShadow={!light}>{light
            ? <meshLambertMaterial map={texture} vertexColors side={THREE.DoubleSide}/>
            : <meshStandardMaterial map={texture} vertexColors roughness={1} side={THREE.DoubleSide}/>}</mesh>
        <RouteScenery track={track} light={light} />
        <RallyRouteMarkings track={track}/>
        {!light && <RallyCrowd track={track}/>}
        {track.obstacles.map(o => {
            const p = rallyPath(track, o.at);
            const color = o.kind === 'shortcut' ? '#62d4b0' : o.kind === 'ramp' ? '#d9b177' : o.kind === 'rock' ? track.palette.rock : track.palette.accent;
            const lane = rallyLanePosition(track, o.at, o.lane * 2.65);
            const frame = rallyPathFrame(track, o.at);
            return <group key={o.id} position={[lane.x, p.y, lane.z]} rotation={[0, frame.yaw, 0]}>
                {o.kind === 'shortcut' ? <>
                    <mesh position={[0, .025, -13]} rotation={[-Math.PI / 2, 0, 0]}><planeGeometry args={[1.4, 26]} /><meshStandardMaterial color={color} emissive={color} emissiveIntensity={.14} /></mesh>
                    <mesh position={[0, 2.3, 0]}><torusGeometry args={[1.15, .085, 6, 18]} /><meshStandardMaterial color={color} emissive={color} emissiveIntensity={.5} /></mesh>
                </> : o.kind === 'ramp' ? <group position={[0, .18, 0]} rotation={[.22, 0, 0]}>
                    <mesh position={[0, 0, 0]} castShadow receiveShadow><boxGeometry args={[2.25, .34, 6]} /><meshStandardMaterial color="#996b43" roughness={.92} /></mesh>
                    <mesh position={[0, .19, 0]}><boxGeometry args={[1.9, .12, 5.7]} /><meshStandardMaterial color="#dfad66" roughness={.82} /></mesh>
                    {!light && <>
                        {[-2.05, -1.2, -.35, .5, 1.35, 2.2].map(z => <mesh key={z} position={[0, .26, z]}><boxGeometry args={[1.9, .045, .11]} /><meshStandardMaterial color="#f4d292" roughness={.78} /></mesh>)}
                        {[-1, 1].map(side => <mesh key={side} position={[side * 1.06, .27, 0]}><boxGeometry args={[.14, .14, 5.85]} /><meshStandardMaterial color="#5d4935" roughness={.9} /></mesh>)}
                    </>}
                </group>
                    : o.kind === 'rock' ? <mesh position={[0, 1.7, 0]} scale={[1.1, 2, 1.3]}><dodecahedronGeometry /><meshStandardMaterial color={color} flatShading /></mesh>
                        : <>
                            <mesh position={[0, o.height / 2 + (o.kind === 'cart' ? .15 : 0), 0]} castShadow receiveShadow><boxGeometry args={[1.9, o.height - (o.kind === 'cart' ? .3 : 0), o.kind === 'cart' ? 2.4 : .45]} /><meshStandardMaterial map={cargoTexture} color={o.kind === 'cart' ? '#b98c58' : color} roughness={.9} /></mesh>
                            <mesh position={[0, o.height * .78, .24]}><boxGeometry args={[1.92, .16, .04]} /><meshStandardMaterial color="#f9d999" /></mesh>
                            {o.kind === 'cart' && !light && <>
                                {[-.9, .9].flatMap(x => [-.8, .8].map(z => <mesh key={`${x}:${z}`} position={[x, .35, z]} rotation={[0, 0, Math.PI / 2]} castShadow><cylinderGeometry args={[.35, .35, .2, 10]} /><meshStandardMaterial color="#463932" /></mesh>))}
                                {[-.55, .55].map(x => <mesh key={x} position={[x, .95, 1.21]}><boxGeometry args={[.12, 1.3, .04]} /><meshStandardMaterial color="#5b4938" /></mesh>)}
                                <mesh position={[0, 1.09, 1.24]} rotation={[0, 0, Math.PI / 4]}><planeGeometry args={[.34, .34]}/><meshStandardMaterial color={track.palette.accent}/></mesh>
                            </>}
                        </>}
            </group>;
        })}
        {rallyPavilions(track).filter((_, i) => !light || i % 2 === 0).map((p, i) => <Pavilion key={i} x={p.x} y={p.y} z={p.z} yaw={p.yaw} light={light} color={p.accent ? track.palette.accent : '#ddb879'} />)}
        {[0, track.length].map(d => {
            const p = rallyPath(track, d);
            const { post } = rallyArch(track, d);
            return <group key={d} position={[p.x, p.y, p.z]}>
                {[-post, post].map(x => <mesh key={x} position={[x, 3, 0]}><boxGeometry args={[.45, 6, .45]} /><meshStandardMaterial color="#715444" /></mesh>)}
                <mesh position={[0, 5.5, 0]}><boxGeometry args={[post * 2 + .2, 1, .15]} /><meshStandardMaterial color={track.palette.accent} /></mesh>
            </group>;
        })}
        {!light && rallyGrandstands(track).map(({ side, x, y, z }) => <group key={side} position={[x, y, z]}>
            {[0, 1, 2].map(row => <mesh key={row} position={[side * row, row * .9 + .4, 0]}><boxGeometry args={[3, .8, 18]} /><meshStandardMaterial color="#a37652" /></mesh>)}
            <Pavilion x={side * 2} y={3} z={-8} color={track.palette.accent} />
        </group>)}
    </>;
}
