// Local review only. Exercises the production PetModel3D, including unkeyed joints.
/* eslint-disable react-refresh/only-export-components -- standalone local QA entry */
import { StrictMode, Suspense, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { PetModel3D, DEFAULT_PET_MODEL_FRAME, type PetModelMotion } from './components/PetModel3D';
import { RendererRetirement } from './components/RendererRetirement';
import { petCombatModel } from './lib/pet-3d-models';
import { PET_VISUAL_QUALITY_PRESETS } from './lib/pet-visual-quality';
import { rawPetPool } from './data/pet-pool';
import { STARTER_PETS } from './data/starter-pets';
import { STARTER_EVOLUTIONS } from './data/pet-evolutions';

const params = new URLSearchParams(location.search);
const catalog = [...rawPetPool, ...STARTER_PETS.map(s => s.pet), ...STARTER_EVOLUTIONS];
const initialPet = catalog.find(p => p.id === params.get('pet')) ?? catalog.find(p => p.id === 'standard-10')!;
const quality = PET_VISUAL_QUALITY_PRESETS[params.get('quality') === 'low' ? 'low' : 'medium'];
const motions: PetModelMotion[] = ['idle', 'run', 'dash', 'windup', 'strike', 'recover', 'stagger', 'dodge', 'guard', 'rest', 'dead'];
function Fighter({ pet, motion, paused, victorious, sequence }: {pet: typeof initialPet; motion: PetModelMotion; paused: boolean; victorious: boolean; sequence: boolean}) {
    const config = useMemo(() => {
        const production = petCombatModel(pet)!;
        return params.has('original') ? { ...production, url: `/.tmp/pet-performance-originals/${new URL(production.url, location.origin).pathname.slice('/pet-models/'.length)}` }
            : params.has('performance') ? { ...production, url: `/.tmp/pet-performance-candidates${new URL(production.url, location.origin).pathname}` }
            : params.has('candidates') ? { ...production, url: `/.tmp/pet-skin-candidates/${new URL(production.url, location.origin).pathname.slice('/pet-models/'.length)}` } : production;
    }, [pet]);
    const frame = useRef({ ...DEFAULT_PET_MODEL_FRAME });
    const elapsed = useRef(0);
    const phrase = useRef({ motion, time: 0 });
    useFrame((state, delta) => {
        if (params.has('time')) {
            const reviewTime = Number(params.get('time'));
            elapsed.current = Number.isFinite(reviewTime) ? Math.max(0, reviewTime) : 0;
        }
        else if (!paused) elapsed.current += Math.min(delta, .05);
        if (phrase.current.motion !== motion) phrase.current = { motion, time: elapsed.current };
        const age = elapsed.current - phrase.current.time, beat = age % 1.7;
        const shownMotion = sequence ? beat < .38 ? 'windup' : beat < .64 ? 'strike' : beat < 1.15 ? 'recover' : 'idle' : motion;
        const progress = sequence ? beat < .38 ? beat / .38 : beat < .64 ? (beat - .38) / .26 : (beat - .64) / .51
            : age / (motion === 'windup' ? .38 : motion === 'strike' ? .26 : .51);
        state.gl.domElement.dataset.motion = shownMotion;
        state.gl.domElement.dataset.motionAge = String(age);
        Object.assign(frame.current, { motion: shownMotion, moving: shownMotion === 'run' || shownMotion === 'dash', speed: shownMotion === 'dash' ? 5 : 3,
            timeline: elapsed.current, faceX: params.get('view') === 'front' ? 0 : .7, faceZ: params.get('view') === 'front' ? 1 : .7,
            contactPose: shownMotion === 'strike' || shownMotion === 'stagger',
            attackPhaseProgress: ['windup', 'strike', 'recover'].includes(shownMotion) ? Math.min(1, progress) : undefined, victorious });
    }, -1);
    return <PetModel3D config={config} frame={frame} quality={quality} element={pet.element} showIdentity={false} />;
}
function Probe({ petId }: { petId: string }) {
    useFrame(({ scene, gl }) => {
        const bones: Record<string, number[]> = {};
        let skinned = 0, atlases = 0;
        scene.traverse(object => {
            if (object instanceof THREE.Bone && !bones[object.name]) bones[object.name] = object.quaternion.toArray();
            if (!(object instanceof THREE.SkinnedMesh)) return;
            skinned++;
            const materials = Array.isArray(object.material) ? object.material : [object.material];
            for (const material of materials) if ((material as THREE.MeshStandardMaterial).map?.image) atlases++;
        });
        gl.domElement.dataset.bones = JSON.stringify(bones);
        gl.domElement.dataset.renderCalls = String(gl.info.render.calls);
        gl.domElement.dataset.renderTriangles = String(gl.info.render.triangles);
        gl.domElement.dataset.petReady = petId;
        gl.domElement.dataset.skinned = String(skinned);
        gl.domElement.dataset.atlases = String(atlases);
    });
    return null;
}
function Preview() {
    const [petId, setPetId] = useState(initialPet.id);
    const pet = catalog.find(p => p.id === petId)!;
    const config = petCombatModel(pet)!;
    const [motion, setMotion] = useState<PetModelMotion>((params.get('motion') as PetModelMotion) || 'idle');
    const [paused, setPaused] = useState(false);
    const [victorious, setVictorious] = useState(false);
    const [sequence, setSequence] = useState(params.has('sequence'));
    const [generation, setGeneration] = useState(0);
    return <main style={{height:'100dvh', background:'#101726', color:'#eef2ff', display:'flex', flexDirection:'column', fontFamily:'system-ui'}}>
        <div style={{padding:12, display:'flex', flexWrap:'wrap', gap:8, alignItems:'center'}}>
            <strong>{pet.name} · {config.visualId}</strong>
            <select aria-label="Pet" value={petId} onChange={e => {setPetId(e.target.value); setGeneration(g => g + 1);}}>{catalog.map(p => <option key={p.id} value={p.id}>{p.name} · {p.id}</option>)}</select>
            <select aria-label="Motion" value={motion} onChange={e => {setMotion(e.target.value as PetModelMotion); setVictorious(false); setSequence(false);}}>{motions.map(m => <option key={m}>{m}</option>)}</select>
            <button aria-pressed={sequence} onClick={() => {setSequence(s => !s); setVictorious(false); setGeneration(g => g + 1);}}>Attack sequence</button>
            <button onClick={() => {setSequence(false); setMotion('idle'); setVictorious(v => !v); setGeneration(g => g + 1);}}>Victory</button>
            <button onClick={() => setPaused(p => !p)}>{paused ? 'Resume' : 'Pause'}</button>
            <button onClick={() => setGeneration(g => g + 1)}>Reset rig</button>
        </div>
        <div style={{flex:1, minHeight:0}}><Canvas dpr={1} camera={{ position:[0,3.5,window.innerWidth < 500 ? 17 : 11], fov:38 }} onCreated={({camera}) => camera.lookAt(0,1.5,0)}>
            <RendererRetirement />
            <color attach="background" args={['#101726']}/><ambientLight intensity={1.4}/>
            <directionalLight position={[3,6,4]} intensity={2.2}/><directionalLight position={[-3,2,-3]} color="#8bc5ff" intensity={1.2}/>
            <Suspense fallback={null}><Fighter key={generation} pet={pet} motion={motion} paused={paused} victorious={victorious} sequence={sequence}/><Probe petId={petId}/></Suspense>
            <gridHelper args={[10,20,'#667085','#2b3547']}/>
            <mesh rotation={[-Math.PI/2,0,0]} position={[0,-.01,0]}><planeGeometry args={[20,20]}/><meshStandardMaterial color="#202d40"/></mesh>
        </Canvas></div>
    </main>;
}
createRoot(document.getElementById('root')!).render(<StrictMode><Preview/></StrictMode>);
