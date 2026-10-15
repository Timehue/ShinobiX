// Local QA only. The production component owns all skeletal/procedural animation.
/* eslint-disable react-refresh/only-export-components -- standalone QA entry */
import { Suspense, useLayoutEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { Canvas, useThree, type RootState } from '@react-three/fiber';
import * as THREE from 'three';
import { PetModel3D, DEFAULT_PET_MODEL_FRAME, type PetModelFrame } from './components/PetModel3D';
import { RendererRetirement } from './components/RendererRetirement';
import { petCombatModel } from './lib/pet-3d-models';
import { PET_VISUAL_QUALITY_PRESETS } from './lib/pet-visual-quality';
import { rawPetPool } from './data/pet-pool';
import { STARTER_PETS } from './data/starter-pets';
import { STARTER_EVOLUTIONS } from './data/pet-evolutions';

type Region = {y:number[];z?:number[];x?:number[];union?:Region[];exclude?:number[][];cameraPadding?:number};
const catalog = [...rawPetPool, ...STARTER_PETS.map(p=>p.pet), ...STARTER_EVOLUTIONS];
const quality = PET_VISUAL_QUALITY_PRESETS[new URLSearchParams(location.search).get('quality') === 'low' ? 'low' : 'medium'];
let state: RootState;
let mounted: (()=>void) | undefined;
let setRequest: (value: Request)=>void;
let meshes: THREE.SkinnedMesh[] = [];
let skullViews: {mesh:THREE.SkinnedMesh;vertices:number[]}[][] = [];
let headRadii:number[]=[], time=0;
const frame = {current:{...DEFAULT_PET_MODEL_FRAME}};
type Request = {id:string;stage:'source'|'battle';region:Region;extraHeads:Region[];generation:number};
function Fighter({request}:{request:Request}) {
    const pet=catalog.find(p=>p.id===request.id)!;
    const production=petCombatModel(pet)!;
    const config={...production,url:request.stage==='battle'?production.url.replace('/pet-models/','/pet-models/warfront-lod/'):production.url};
    const group=useRef<THREE.Group>(null);
    useLayoutEffect(()=>{
        group.current!.updateMatrixWorld(true);
        meshes=[];
        group.current!.traverse(node=>{
            if(node instanceof THREE.SkinnedMesh) {
                const materials=Array.isArray(node.material)?node.material:[node.material];
                if(materials.some(m=>m.side!==THREE.BackSide))meshes.push(node);
            }
        });
        if(!meshes.length)throw Error('Production component has no skinned surface');
        const yaw=new THREE.Matrix4().makeRotationY(config.yawOffset);
        const points:{mesh:THREE.SkinnedMesh;v:number;p:THREE.Vector3}[]=[];
        for(const mesh of meshes){mesh.skeleton.update();for(let v=0;v<mesh.geometry.attributes.position.count;v++)
            points.push({mesh,v,p:mesh.getVertexPosition(v,new THREE.Vector3()).applyMatrix4(mesh.matrixWorld).applyMatrix4(yaw)});}
        const bounds=new THREE.Box3().setFromPoints(points.map(v=>v.p)),center=bounds.getCenter(new THREE.Vector3());
        const scale=2/Math.max(...bounds.getSize(new THREE.Vector3()).toArray());
        skullViews=[];headRadii=[];
        for(const r of [request.region,...request.extraHeads]){
        const skull=meshes.map(mesh=>({mesh,vertices:[] as number[]}));const selected:THREE.Vector3[]=[];
        for(const {mesh,v,p} of points){const normalized=p.clone().sub(center).multiplyScalar(scale);
            const core=(region:Region)=>normalized.y>=region.y[1]&&(!region.z||normalized.z>=region.z[1])&&(!region.x||Math.abs(normalized.x)<=region.x[0]);
            if(![r,...r.union??[]].some(core)||r.exclude?.some(b=>normalized.x>=b[0]&&normalized.x<=b[1]&&normalized.y>=b[2]&&normalized.y<=b[3]&&normalized.z>=b[4]&&normalized.z<=b[5]))continue;
            skull.find(s=>s.mesh===mesh)!.vertices.push(v);selected.push(p);
        }
        if(selected.length<20)throw Error(`Runtime head camera selected ${selected.length} vertices for ${request.id}`);
        headRadii.push(new THREE.Box3().setFromPoints(selected).getSize(new THREE.Vector3()).length()*.52*(r.cameraPadding??1));skullViews.push(skull);
        }
        mounted?.();mounted=undefined;
    },[config.yawOffset,request.id,request.region,request.extraHeads]);
    return <group ref={group}><PetModel3D config={config} frame={frame} quality={quality} element={pet.element} showIdentity={false}/></group>;
}
function Control() {const current=useThree();useLayoutEffect(()=>{state=current;},[current]);return null;}
function App(){const [request,update]=useState<Request|null>(null);useLayoutEffect(()=>{setRequest=update;},[]);
    return <div style={{width:320,height:320}}><Canvas frameloop="never" dpr={1} gl={{antialias:true,preserveDrawingBuffer:true}} camera={{fov:35,near:.001,far:1000}}>
        <RendererRetirement />
        <color attach="background" args={['#101726']}/><ambientLight intensity={1.4}/>
        <directionalLight position={[3,5,4]} intensity={2.2}/><directionalLight position={[-3,2,-3]} color="#8bc5ff" intensity={1.2}/>
        <Control/><Suspense fallback={null}>{request&&<Fighter key={request.generation} request={request}/>}</Suspense>
    </Canvas></div>;
}
let generation=0;
const api={
    async load(id:string,stage:'source'|'battle',region:Region,extraHeads:Region[]=[]){
        if(!catalog.some(p=>p.id===id))throw Error('Unknown pet');
        frame.current={...DEFAULT_PET_MODEL_FRAME,faceX:0,faceZ:1,moveX:0,moveZ:1,lockTargetFacing:true,timeline:0};time=0;
        const ready=new Promise<void>(resolve=>{mounted=resolve;});
        flushSync(()=>setRequest({id,stage,region,extraHeads,generation:++generation}));
        await ready;state.advance(0,false);
        return {meshes:meshes.length,headVertices:skullViews.map(skull=>skull.reduce((n,s)=>n+s.vertices.length,0)),quality:quality.id};
    },
    step(delta:number,patch:Partial<PetModelFrame>){
        if(delta<0||delta>.051)throw Error('Review must advance through real intermediate frames');
        time+=delta;Object.assign(frame.current,patch,{timeline:time});state.advance(time,false);
        state.scene.updateMatrixWorld(true);for(const mesh of meshes)mesh.skeleton.update();
        return time;
    },
    render(view:'front'|'side',part:'head'|'body',headIndex=0){
        const points:THREE.Vector3[]=[];
        if(part==='head'){for(const {mesh,vertices} of skullViews[headIndex])for(const v of vertices)points.push(mesh.getVertexPosition(v,new THREE.Vector3()).applyMatrix4(mesh.matrixWorld));}
        else for(const mesh of meshes)for(let v=0;v<mesh.geometry.attributes.position.count;v+=Math.max(1,Math.floor(mesh.geometry.attributes.position.count/1500)))points.push(mesh.getVertexPosition(v,new THREE.Vector3()).applyMatrix4(mesh.matrixWorld));
        const bounds=new THREE.Box3().setFromPoints(points),target=bounds.getCenter(new THREE.Vector3());
        const extent=part==='head'?headRadii[headIndex]:Math.max(...bounds.getSize(new THREE.Vector3()).toArray())*.66;
        const distance=extent/Math.tan(THREE.MathUtils.degToRad(17.5))*1.15;
        state.camera.position.copy(target).add(view==='front'?new THREE.Vector3(0,extent*.2,distance):new THREE.Vector3(distance,extent*.2,0));
        state.camera.near=Math.max(.001,distance/1000);state.camera.far=distance*20;state.camera.updateProjectionMatrix();state.camera.lookAt(target);
        state.gl.render(state.scene,state.camera);
        return state.gl.domElement.toDataURL('image/png');
    },
};
(window as unknown as {petRuntimeAudit:typeof api}).petRuntimeAudit=api;
createRoot(document.getElementById('root')!).render(<App/>);
