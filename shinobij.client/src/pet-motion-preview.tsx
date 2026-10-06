// Local review only. Exercises the production PetModel3D, including unkeyed joints.
/* eslint-disable react-refresh/only-export-components -- standalone local QA entry */
import { StrictMode, Suspense, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { PetModel3D, DEFAULT_PET_MODEL_FRAME, type PetModelMotion } from './components/PetModel3D';
import { petCombatModel } from './lib/pet-3d-models';
import { PET_VISUAL_QUALITY_PRESETS } from './lib/pet-visual-quality';
import { rawPetPool } from './data/pet-pool';
import { STARTER_PETS } from './data/starter-pets';
import { STARTER_EVOLUTIONS } from './data/pet-evolutions';

const params = new URLSearchParams(location.search);
const catalog = [...rawPetPool, ...STARTER_PETS.map(s => s.pet), ...STARTER_EVOLUTIONS];
const pet = catalog.find(p => p.id === params.get('pet')) ?? catalog.find(p => p.id === 'standard-10')!;
const config = petCombatModel(pet)!;
const quality = PET_VISUAL_QUALITY_PRESETS[params.get('quality') === 'low' ? 'low' : 'medium'];
const motions: PetModelMotion[] = ['idle', 'run', 'dash', 'windup', 'strike', 'recover', 'stagger', 'dodge', 'guard', 'rest', 'dead'];
function Fighter({ motion, paused, victorious }: {motion: PetModelMotion; paused: boolean; victorious: boolean}) {
    const frame = useRef({ ...DEFAULT_PET_MODEL_FRAME });
    const elapsed = useRef(0);
    useFrame((_, delta) => {
        if (!paused) elapsed.current += Math.min(delta, .05);
        Object.assign(frame.current, { motion, moving: motion === 'run' || motion === 'dash', speed: motion === 'dash' ? 5 : 3,
            timeline: elapsed.current, faceX: .7, faceZ: .7, contactPose: motion === 'strike' || motion === 'stagger', victorious });
    }, -1);
    return <PetModel3D config={config} frame={frame} quality={quality} element={pet.element} showIdentity={false} />;
}
function Probe() {
    useFrame(({ scene, gl }) => {
        const bones: Record<string, number[]> = {};
        scene.traverse(o => { if (o instanceof THREE.Bone && !bones[o.name]) bones[o.name] = o.quaternion.toArray(); });
        gl.domElement.dataset.bones = JSON.stringify(bones);
        gl.domElement.dataset.renderCalls = String(gl.info.render.calls);
        gl.domElement.dataset.renderTriangles = String(gl.info.render.triangles);
    });
    return null;
}
function Preview() {
    const [motion, setMotion] = useState<PetModelMotion>('idle');
    const [paused, setPaused] = useState(false);
    const [victorious, setVictorious] = useState(false);
    const [generation, setGeneration] = useState(0);
    return <main style={{height:'100dvh', background:'#101726', color:'#eef2ff', display:'flex', flexDirection:'column', fontFamily:'system-ui'}}>
        <div style={{padding:12, display:'flex', flexWrap:'wrap', gap:8, alignItems:'center'}}>
            <strong>{pet.name} · {config.visualId}</strong>
            <select aria-label="Motion" value={motion} onChange={e => {setMotion(e.target.value as PetModelMotion); setVictorious(false);}}>{motions.map(m => <option key={m}>{m}</option>)}</select>
            <button onClick={() => setVictorious(v => !v)}>Victory</button>
            <button onClick={() => setPaused(p => !p)}>{paused ? 'Resume' : 'Pause'}</button>
            <button onClick={() => setGeneration(g => g + 1)}>Reset rig</button>
        </div>
        <div style={{flex:1, minHeight:0}}><Canvas dpr={1} camera={{ position:[0,3.5,window.innerWidth < 500 ? 17 : 11], fov:38 }} onCreated={({camera}) => camera.lookAt(0,1.5,0)}>
            <color attach="background" args={['#101726']}/><ambientLight intensity={1.4}/>
            <directionalLight position={[3,6,4]} intensity={2.2}/><directionalLight position={[-3,2,-3]} color="#8bc5ff" intensity={1.2}/>
            <Suspense fallback={null}><Fighter key={generation} motion={motion} paused={paused} victorious={victorious}/><Probe/></Suspense>
            <gridHelper args={[10,20,'#667085','#2b3547']}/>
            <mesh rotation={[-Math.PI/2,0,0]} position={[0,-.01,0]}><planeGeometry args={[20,20]}/><meshStandardMaterial color="#202d40"/></mesh>
        </Canvas></div>
    </main>;
}
createRoot(document.getElementById('root')!).render(<StrictMode><Preview/></StrictMode>);
