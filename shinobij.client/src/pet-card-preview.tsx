// Local QA only: real production models and card controllers under StrictMode.
import { StrictMode, Suspense, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Canvas, useFrame } from '@react-three/fiber';
import { PetModel3D, DEFAULT_PET_MODEL_FRAME } from './components/PetModel3D';
import { PetSummon3D } from './components/PetSummon3D';
import { PetCardSwap3D } from './components/PetCardSwap3D';
import { RendererRetirement } from './components/RendererRetirement';
import { PetEvolutionStage3D } from './components/PetEvolutionStage3D';
import { evolutionPhaseAt } from './lib/pet-evolution-cutscene';
import { petCombatModel } from './lib/pet-3d-models';
import { PET_VISUAL_QUALITY_PRESETS } from './lib/pet-visual-quality';
import { rawPetPool } from './data/pet-pool';
import { STARTER_PETS } from './data/starter-pets';
import { STARTER_EVOLUTIONS } from './data/pet-evolutions';
import type { Pet } from './types/pet';
import { IntroCompanion3D } from './features/intro-cinematic/IntroCompanion3D';
import { PetSceneRecall, usePetSceneRecall } from './components/PetSceneRecall';

const catalog = [...rawPetPool, ...STARTER_PETS.map(item => item.pet), ...STARTER_EVOLUTIONS];
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
function Model({ pet, paused, ko }: { pet: Pet; paused: boolean; ko: boolean }) {
    const frame = useRef({ ...DEFAULT_PET_MODEL_FRAME, faceX: .3, faceZ: 1 });
    useFrame((_, delta) => {
        if (!paused) frame.current.timeline = (frame.current.timeline ?? 0) + Math.min(delta, .05);
        frame.current.motion = ko ? 'dead' : 'idle';
    }, -1);
    return <PetModel3D config={petCombatModel(pet)!} frame={frame} quality={PET_VISUAL_QUALITY_PRESETS.low} element={pet.element} showIdentity={false} />;
}
function Probe() {
    useFrame(({ scene, gl }) => {
        const phases: string[] = [];
        const poses: number[][] = [];
        scene.traverse(object => { if (object.userData.petCardEnabled) { phases.push(object.userData.petCardPhase); const body = object.children[0]; poses.push([body.scale.x, body.position.y]); } });
        gl.domElement.dataset.petCardPhases = phases.join(',');
        gl.domElement.dataset.petCardPoses = JSON.stringify(poses);
        gl.domElement.dataset.geometries = String(gl.info.memory.geometries);
        gl.domElement.dataset.textures = String(gl.info.memory.textures);
    });
    return null;
}
function Preview() {
    const scene = usePetSceneRecall();
    const [closed, setClosed] = useState(false);
    const [sceneExits, setSceneExits] = useState(0);
    const [exitError, setExitError] = useState('');
    const [demand, setDemand] = useState(false);
    const [petId, setPetId] = useState('standard-10');
    const [present, setPresent] = useState(true);
    const [paused, setPaused] = useState(false);
    const [ko, setKo] = useState(false);
    const [swap, setSwap] = useState(false);
    const [completions, setCompletions] = useState(0);
    const [recalls, setRecalls] = useState(0);
    const [evolution, setEvolution] = useState(false);
    const [evoTime, setEvoTime] = useState(0);
    const [evoPlaying, setEvoPlaying] = useState(false);
    const [intro, setIntro] = useState(false);
    useEffect(() => {
        if (!evoPlaying) return;
        let frame = 0;
        const start = performance.now();
        const tick = (now: number) => { setEvoTime(Math.min(8700, now - start)); if (now - start < 8700) frame = requestAnimationFrame(tick); };
        frame = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(frame);
    }, [evoPlaying]);
    const pet = catalog.find(item => item.id === petId)!;
    return <PetSceneRecall controller={scene.controller}><main data-scene-recalling={scene.recalling} style={{ background: '#122233', color: '#fff', minHeight: '100vh' }}>
        <div style={{ display: 'flex', gap: 8, padding: 10, flexWrap: 'wrap' }}>
            <select aria-label="Pet" value={petId} onChange={event => setPetId(event.target.value)}>{catalog.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
            <button onClick={() => { setPresent(false); setKo(false); }}>Recall</button>
            <button onClick={() => { setPresent(true); setKo(false); }}>Summon</button>
            <button onClick={() => { setPresent(false); setKo(true); }}>KO</button>
            <button onClick={() => setPaused(value => !value)}>{paused ? 'Resume' : 'Pause'}</button>
            <button onClick={() => setSwap(value => !value)}>{swap ? 'Single' : 'Swap mode'}</button>
            <button onClick={() => setEvolution(value => !value)}>Evolution</button>
            <button onClick={() => setEvoPlaying(value => !value)}>Play evolution</button>
            <button onClick={() => setIntro(value => !value)}>Companion preview</button>
            <button onClick={() => setDemand(value => !value)}>Demand mode</button>
            <button onClick={() => void scene.controller.run(() => { setSceneExits(value => value + 1); setClosed(true); })}>Scene exit</button>
            <button onClick={() => void scene.controller.run(() => { throw new Error('exit failed'); }).catch(error => setExitError(error.message))}>Failed exit</button>
            <button onClick={() => { setClosed(false); setPresent(true); setKo(false); }}>Reopen</button>
            <input aria-label="Evolution time" type="range" min="0" max="8700" step="20" value={evoTime} onChange={event => setEvoTime(Number(event.target.value))} />
            <output data-testid="completions">{completions}:{recalls}</output>
            <output data-testid="evo-time">{Math.round(evoTime)}</output>
            <output data-testid="scene-exits">{sceneExits}</output><output data-testid="exit-error">{exitError}</output>
        </div>
        <div style={{ width: 'min(900px, 100vw)', height: 540 }}>
            {closed ? <p role="status">Scene closed</p> : intro ? <IntroCompanion3D pet={pet} label={pet.name} fallbackSrc="/items/beast-seal-reinforced.webp" /> : evolution ? <PetEvolutionStage3D phase={evolutionPhaseAt(evoTime)} pet={STARTER_EVOLUTIONS.find(item => item.id === 'starter-fire-r')!} oldVisualId="starter-fire" element="Fire" reduced={reduced} /> :
            <Canvas frameloop={demand ? 'demand' : 'always'} dpr={1} camera={{ position: [0, 3.2, 9], fov: 44 }} onCreated={({ camera }) => camera.lookAt(0, 2, 0)}>
                <RendererRetirement /><ambientLight intensity={1.4} /><directionalLight position={[4, 6, 5]} intensity={2} />
                <mesh rotation={[-Math.PI / 2, 0, 0]}><planeGeometry args={[20, 20]} /><meshStandardMaterial color="#182c37" /></mesh>
                <Suspense fallback={null}>
                    {swap ? <PetCardSwap3D identity={petId} reducedMotion={reduced}><Model pet={pet} paused={paused} ko={false} /></PetCardSwap3D> :
                        <PetSummon3D key={petId} present={present} playing={!paused} reducedMotion={reduced} recallDelay={ko ? .9 : 0}
                            onComplete={() => setCompletions(value => value + 1)} onRecallComplete={() => setRecalls(value => value + 1)}>
                            <Model pet={pet} paused={paused} ko={ko} />
                        </PetSummon3D>}
                </Suspense>
                <Probe />
            </Canvas>}
        </div>
    </main></PetSceneRecall>;
}
createRoot(document.getElementById('root')!).render(<StrictMode><Preview /></StrictMode>);
