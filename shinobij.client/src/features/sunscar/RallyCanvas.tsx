import { memo, Suspense, useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { RendererRetirement } from '../../components/RendererRetirement';
import * as THREE from 'three';
import { rallyPath, rallyTrack } from '../../../../shared/sunscar/rally-tracks';
import type { RallyState } from '../../../../shared/sunscar/rally-types';
import { RallyPetModel } from './RallyPetModel';
import { RallyTrackScene } from './RallyTrackScene';
import { PetModelBoundary } from '../../components/PetModelBoundary';
import { RallySun } from './RallyEnvironment';
import { RallyPetEffects } from './RallyPetEffects';
import { rallyCameraGoal } from './rally-presentation';
import { isLowEndMobile } from '../../lib/device-tier';
import { RallyShotEffects } from './RallyShotEffects';
import { newRallyQualitySample, rallyStartsLight, sampleRallyQuality } from './rally-quality';
import { RallyAimGuide } from './RallyAimGuide';

function RaceClock({ advance }: { advance: (delta: number) => void }) {
    useFrame((_, delta) => advance(Math.min(delta, .1)), -2);
    return null;
}
function RallyAdaptiveQuality({ state, onLight }: { state: RefObject<RallyState>; onLight: () => void }) {
    const sample = useRef(newRallyQualitySample()), lastTick = useRef(0);
    useFrame((_, delta) => {
        const race = state.current;
        if (sampleRallyQuality(sample.current, delta, race.tick !== lastTick.current && !race.finished)) onLight();
        lastTick.current = race.tick;
    });
    return null;
}
function RallyQaMetrics({ state, light }: { state: RefObject<RallyState>; light: boolean }) {
    const frames = useRef<number[]>([]);
    const frameCount = useRef(0);
    const elapsed = useRef(0);
    useFrame(({ gl }, delta) => {
        if (import.meta.env.MODE !== 'sunscar-modes-qa') return;
        frameCount.current++;
        frames.current.push(delta); if (frames.current.length > 120) frames.current.shift();
        elapsed.current += delta;
        if (elapsed.current < .1 && frameCount.current > 1) return;
        elapsed.current = 0;
        // Read-only instrumentation, removed from the normal production build.
        queueMicrotask(() => {
            (window as Window & { sunscarRallyQa?: unknown }).sunscarRallyQa = {
                state: structuredClone(state.current), geometry: gl.info.memory.geometries, textures: gl.info.memory.textures,
                calls: gl.info.render.calls, triangles: gl.info.render.triangles,
                frameCount: frameCount.current,
                quality: light ? 'light' : 'full', pixelRatio: gl.getPixelRatio(),
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
        const goal = rallyCameraGoal(rallyTrack(race.trackId), race.racers[0], race.finished, (camera as THREE.PerspectiveCamera).aspect, reducedMotion);
        desired.set(...goal.position);
        target.set(...goal.look);
        const blend = started.current ? 1 - Math.exp(-Math.min(delta, .1) * 5) : 1;
        camera.position.lerp(desired, blend);
        look.current.lerp(target, blend);
        // Reduced motion cuts to the finish framing rather than pulling back.
        if (reducedMotion && race.finished) { camera.position.copy(desired); look.current.copy(target); }
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
/** Memoised: the race HUD updates ten times a second, and each Canvas
 * re-render reconciled every mesh on the course for nothing (the scene reads
 * the race from the ref each frame). That was about half of the race's
 * JavaScript. Devices on the shared lite gate (weak touch hardware, reduced
 * motion, or the liteFx.v1 override) draw at 1x without MSAA. */
export default memo(function RallyCanvas({ state, advance, onReady, onFail, reducedMotion, frameloop }: {
    state: RefObject<RallyState>; advance: (delta: number) => void; onReady: (id: string) => void; onFail: () => void; reducedMotion: boolean; frameloop: 'always' | 'demand';
}) {
    const track = rallyTrack(state.current.trackId);
    const [lite] = useState(() => {
        try { const override = localStorage.getItem('liteFx.v1'); if (override === '0' || override === '1') return override === '1'; } catch { /* storage may be unavailable */ }
        return isLowEndMobile() || rallyStartsLight(navigator.hardwareConcurrency, (navigator as Navigator & { deviceMemory?: number }).deviceMemory);
    });
    const [light, setLight] = useState(lite);
    const lowerQuality = useCallback(() => setLight(true), []);
    return <Canvas shadows={light ? false : 'percentage'} dpr={light ? 1 : [1, 1.5]} frameloop={frameloop} camera={{ fov: 57, near: .1, far: light ? 150 : 220 }} gl={{ antialias: !lite, powerPreference: 'high-performance' }}
        onCreated={({ gl }) => { gl.toneMapping = THREE.ACESFilmicToneMapping; gl.toneMappingExposure = 1.05; }}>
        <RendererRetirement />
        <CanvasLifecycle onFail={onFail}/>
        <RaceClock advance={advance} />
        {!light && <RallyAdaptiveQuality state={state} onLight={lowerQuality}/>}
        {import.meta.env.MODE === 'sunscar-modes-qa' && <RallyQaMetrics state={state} light={light}/>}
        <RallySun state={state} light={light}/>
        <directionalLight position={[12, 18, 24]} intensity={.9} color="#d5e9ff" />
        <RallyTrackScene track={track} light={light} />
        <RaceCamera state={state} reducedMotion={reducedMotion} />
        {!light && !reducedMotion && <Dust state={state} />}
        <RallyShotEffects state={state} />
        <RallyAimGuide state={state}/>
        {state.current.racers.map((racer, index) => <RallyPetEffects key={racer.id} state={state} index={index} light={light || reducedMotion} reducedMotion={reducedMotion} color={index === 0 ? '#ffe6a0' : '#fff0d5'}/>)}
        {state.current.racers.map((racer, index) => <PetModelBoundary key={racer.id} onFail={onFail}><Suspense fallback={null}>
            <RallyPetModel state={state} index={index} onReady={onReady} reducedMotion={reducedMotion} />
        </Suspense></PetModelBoundary>)}
    </Canvas>;
});
