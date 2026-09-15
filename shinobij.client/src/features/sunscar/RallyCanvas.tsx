import { Suspense, useEffect, useMemo, useRef, type RefObject } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { rallyPath, rallyTrack } from '../../../../shared/sunscar/rally-tracks';
import type { RallyState } from '../../../../shared/sunscar/rally-types';
import { RallyPetModel } from './RallyPetModel';
import { RallyTrackScene } from './RallyTrackScene';
import { PetModelBoundary } from '../../components/PetModelBoundary';
import { RallySun } from './RallyEnvironment';
import { RallyPetEffects } from './RallyPetEffects';

function RaceClock({ advance }: { advance: (delta: number) => void }) {
    useFrame((_, delta) => advance(Math.min(delta, .1)), -2);
    return null;
}
function RallyQaMetrics({ state }: { state: RefObject<RallyState> }) {
    const frames = useRef<number[]>([]);
    const frameCount = useRef(0);
    useFrame(({ gl }, delta) => {
        if (import.meta.env.MODE !== 'sunscar-modes-qa') return;
        frameCount.current++;
        frames.current.push(delta); if (frames.current.length > 120) frames.current.shift();
        // Read-only instrumentation, removed from the normal production build.
        queueMicrotask(() => {
            (window as Window & { sunscarRallyQa?: unknown }).sunscarRallyQa = {
                state: structuredClone(state.current), geometry: gl.info.memory.geometries, textures: gl.info.memory.textures,
                calls: gl.info.render.calls, triangles: gl.info.render.triangles,
                frameCount: frameCount.current,
                fps: frames.current.length / frames.current.reduce((sum, time) => sum + time, 0),
            };
        });
    });
    useEffect(() => () => { if (import.meta.env.MODE === 'sunscar-modes-qa') delete (window as Window & { sunscarRallyQa?: unknown }).sunscarRallyQa; }, []);
    return null;
}
function RaceCamera({ state, reducedMotion }: { state: RefObject<RallyState>; reducedMotion: boolean }) {
    const started = useRef(false);
    const look = useRef(new THREE.Vector3());
    const desired = useMemo(() => new THREE.Vector3(), []);
    const target = useMemo(() => new THREE.Vector3(), []);
    useFrame(({ camera }, delta) => {
        const race = state.current;
        const player = race.racers[0];
        const path = rallyPath(rallyTrack(race.trackId), player.distance);
        const preview = rallyPath(rallyTrack(race.trackId), player.distance + 20);
        const finish = race.finished;
        const finishDistance = Math.max(13, 9 / (camera as THREE.PerspectiveCamera).aspect);
        desired.set(path.x + (finish ? 0 : player.lane * (reducedMotion ? .7 : 1.2)), path.y + (finish ? 7 : 5) + player.jump * .25, path.z + (finish ? finishDistance : 10));
        target.set(finish ? path.x : preview.x * .2 + path.x * .8 + player.lane * .7, path.y + 1.45 + player.jump * .6, path.z - (finish ? 2 : 6));
        const blend = started.current ? 1 - Math.exp(-Math.min(delta, .1) * 5) : 1;
        camera.position.lerp(desired, blend);
        look.current.lerp(target, blend);
        camera.lookAt(look.current);
        started.current = true;
    });
    return null;
}
function CanvasLifecycle({ onFail }: { onFail: () => void }) {
    const gl = useThree(s => s.gl);
    useEffect(() => {
        const lost = (event: Event) => { event.preventDefault(); onFail(); };
        gl.domElement.addEventListener('webglcontextlost', lost);
        return () => gl.domElement.removeEventListener('webglcontextlost', lost);
    }, [gl, onFail]);
    return null;
}
function Dust({ state }: { state: RefObject<RallyState> }) {
    const points = useRef<THREE.Points>(null);
    const positions = useMemo(() => new Float32Array(72 * 3), []);
    useFrame(() => {
        const race = state.current;
        const p = race.racers[0];
        const path = rallyPath(rallyTrack(race.trackId), p.distance);
        const attr = points.current?.geometry.attributes.position as THREE.BufferAttribute | undefined;
        if (!attr) return;
        for (let i = 0; i < 72; i++) {
            const age = ((i / 72 + race.tick / 180) % 1);
            attr.setXYZ(i, path.x + p.lane * 2.65 + Math.sin(i * 13) * age * 1.7, path.y + .08 + age * .7, path.z + age * 6);
        }
        attr.needsUpdate = true;
        if (points.current) points.current.visible = p.speed > 3 && p.jump < .2 && p.finishTick === null;
    });
    return <points ref={points} frustumCulled={false}><bufferGeometry><bufferAttribute attach="attributes-position" args={[positions, 3]} /></bufferGeometry><pointsMaterial color="#ead1a0" size={.1} transparent opacity={.38} depthWrite={false} /></points>;
}
export default function RallyCanvas({ state, advance, onReady, onFail, reducedMotion, frameloop }: {
    state: RefObject<RallyState>; advance: (delta: number) => void; onReady: (id: string) => void; onFail: () => void; reducedMotion: boolean; frameloop: 'always' | 'demand';
}) {
    const track = rallyTrack(state.current.trackId);
    return <Canvas shadows dpr={[1, 1.5]} frameloop={frameloop} camera={{ fov: 57, near: .1, far: 220 }} gl={{ antialias: true, powerPreference: 'high-performance' }}
        onCreated={({ gl }) => { gl.toneMapping = THREE.ACESFilmicToneMapping; gl.toneMappingExposure = 1.05; }}>
        <CanvasLifecycle onFail={onFail}/>
        <RaceClock advance={advance} />
        {import.meta.env.MODE === 'sunscar-modes-qa' && <RallyQaMetrics state={state}/>}
        <RallySun state={state}/>
        <RallyTrackScene track={track} />
        <RaceCamera state={state} reducedMotion={reducedMotion} />
        <Dust state={state} />
        {state.current.racers.map((racer, index) => <RallyPetEffects key={racer.id} state={state} index={index} color={index === 0 ? '#ffe6a0' : '#fff0d5'}/>)}
        {state.current.racers.map((racer, index) => <PetModelBoundary key={racer.id} onFail={onFail}><Suspense fallback={null}>
            <RallyPetModel state={state} index={index} onReady={onReady} />
        </Suspense></PetModelBoundary>)}
    </Canvas>;
}
