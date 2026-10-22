import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import * as T from 'three';
import {repairReviewedPetSkull} from './repair-reviewed-pet-skull.mjs';
import {repairAshCrownPhoenixAnatomicalNeck} from './lib/pet-ash-crown-phoenix-anatomical-neck.mjs';
import {repairAshCrownPhoenixAnatomicalLegs} from './lib/pet-ash-crown-phoenix-anatomical-legs.mjs';
import {loadPetDeformationProbe,snapshotPetPose,petClipSampleTimes} from './lib/pet-deformation-probe.mjs';
import {createIndependentFaceProbe} from '../src/pet-independent-face-probe.ts';

const originalUrl=new URL('./fixtures/pet-complete-face-20261015/mythic-10-v1.glb',import.meta.url);
const fixtures=new URL('./fixtures/pet-ash-crown-phoenix-anatomy/',import.meta.url);
const faceBytes=await readFile(new URL('face.glb',fixtures)),neck=await repairAshCrownPhoenixAnatomicalNeck(faceBytes),final=await repairAshCrownPhoenixAnatomicalLegs(neck.bytes);
const expectedSha='fd4f4f9db5a9b048706a8a9d59ff72f3e55b42d164e903db9c6998c31cfc1762',sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const annotation=JSON.parse(await readFile(new URL('./pet-independent-face-landmarks.json',import.meta.url))).pets['mythic-10'];
const config=JSON.parse(await readFile(new URL('./pet-complete-face-repairs.json',import.meta.url))).pets['mythic-10'];
const pads=JSON.parse(await readFile(new URL('visible-sole-landmarks.json',fixtures))).paws;
const temp=await mkdtemp(join(tmpdir(),'ash-crown-phoenix-')),finalPath=join(temp,'final.glb');await writeFile(finalPath,final.bytes);
test.after(async()=>{await rm(temp,{recursive:true,force:true});});

function sweepFace(model){
 const probe=createIndependentFaceProbe(model.meshes,annotation),restore=snapshotPetPose(model.scene),mixer=new T.AnimationMixer(model.scene);
 for(const clip of model.animations)for(const time of petClipSampleTimes(clip,24)){
  mixer.stopAllAction();restore();const action=mixer.clipAction(clip).reset().setLoop(T.LoopOnce,1);action.clampWhenFinished=true;action.play();action.time=time;mixer.update(0);model.update();probe.measure(time);
 }
 for(const from of model.animations)for(const to of model.animations)if(from!==to)for(const blend of [.25,.5,.75]){
  mixer.stopAllAction();restore();for(const[clip,weight,progress]of[[from,1-blend,.75],[to,blend,.25]]){const a=mixer.clipAction(clip).reset().setLoop(T.LoopOnce,1);a.clampWhenFinished=true;a.setEffectiveWeight(weight).play();a.time=clip.duration*progress;}mixer.update(0);model.update();probe.measure(blend);
 }
 return probe.report();
}

test('Ash Crown Phoenix original frozen beak and crest patches detect the released defect and pass the fitted source',async()=>{
 assert.equal(annotation.headCountVisuallyVerified,1);assert.equal(Object.keys(annotation.landmarks).length,5);
 const before=await loadPetDeformationProbe(originalUrl);assert.equal(before.sha256,annotation.sourceSha256);assert.equal(sweepFace(before).failed,true);
 const result=sweepFace(await loadPetDeformationProbe(finalPath));assert.equal(result.failed,false,JSON.stringify(result));
});

test('Ash Crown Phoenix rebuilt battle LOD passes the same original face patches through every clip and blend',async()=>{
 assert.equal(sweepFace(await loadPetDeformationProbe(new URL('../public/pet-models/warfront-lod/roster/mythic-10.glb',import.meta.url))).failed,false);
});

test('Ash Crown Phoenix fitted neck and legs preserve the sculpture, textures, original frames and inverse binds',async()=>{
 const before=await loadPetDeformationProbe(originalUrl),after=await loadPetDeformationProbe(finalPath),a=before.meshes[0],b=after.meshes[0];
 for(const name of ['position','normal','uv'])assert.deepEqual(a.geometry.attributes[name].array,b.geometry.attributes[name].array,name);assert.deepEqual(a.geometry.index.array,b.geometry.index.array);assert.equal(b.skeleton.bones.length,29);
 for(const[i,node]of before.json.nodes.entries()){const actual=structuredClone(after.json.nodes[i]);if(actual.name?.startsWith('legacy_face_'))actual.name=actual.name.slice(12);else if(actual.name?.startsWith('legacy_'))actual.name=actual.name.slice(7);if(node.children)actual.children=actual.children.filter(i=>i<before.json.nodes.length);else delete actual.children;assert.deepEqual(actual,node);}
 for(const[i,ib]of a.skeleton.boneInverses.entries())assert.deepEqual(b.skeleton.boneInverses[i].toArray(),ib.toArray());assert.deepEqual(after.json.materials,before.json.materials);assert.deepEqual(after.json.textures,before.json.textures);
 for(const[i,img]of before.json.images.entries()){const x=before.json.bufferViews[img.bufferView],y=after.json.bufferViews[after.json.images[i].bufferView];assert.deepEqual(before.binary.subarray(x.byteOffset,x.byteOffset+x.byteLength),after.binary.subarray(y.byteOffset,y.byteOffset+y.byteLength));}
 let drift=0;for(let v=0;v<a.geometry.attributes.position.count;v++)drift=Math.max(drift,a.getVertexPosition(v,new T.Vector3()).applyMatrix4(a.matrixWorld).distanceTo(b.getVertexPosition(v,new T.Vector3()).applyMatrix4(b.matrixWorld)));assert.ok(drift<.00001,`Rest drift ${drift}`);
});

test('Ash Crown Phoenix retains 170 original curves outside eleven intentional body-support changes',async()=>{
 const before=await loadPetDeformationProbe(originalUrl),after=await loadPetDeformationProbe(finalPath);let preserved=0,changed=0;
 for(const clip of before.animations){const candidate=after.animations.find(c=>c.name===clip.name);assert.equal(candidate.duration,clip.duration);
  for(const t of clip.tracks){const target=/^(head|neck)\./.test(t.name)?'legacy_face_'+t.name:/^(thigh|shin|foot)[LR]\./.test(t.name)?'legacy_'+t.name:t.name,u=candidate.tracks.find(u=>u.name===target);assert.ok(u,clip.name+'/'+target);
   const intentional=(['idle','walk','gallop','guard','rest'].includes(clip.name)&&t.name==='root.position')||(['attack','cast','idle_hitreact1'].includes(clip.name)&&['root.position','chest.quaternion','pelvis.quaternion'].includes(t.name));
   if(intentional){changed++;continue;}assert.deepEqual(u.times,t.times,clip.name+'/'+t.name);assert.deepEqual(u.values,t.values,clip.name+'/'+t.name);preserved++;
  }
 }
 assert.equal(preserved,170);assert.equal(changed,11);assert.equal(after.json.extras.ashCrownPhoenixAnatomicalNeckRepair.clips.reduce((n,c)=>n+c.tracks,0),18);
});

test('Ash Crown Phoenix pinned three-stage recipe reproduces the reviewed bytes and rejects unexpected sources',async()=>{
 const path=join(temp,'face.glb');await repairReviewedPetSkull('mythic-10',fileURLToPath(originalUrl),path,config);assert.deepEqual(await readFile(path),faceBytes);
 assert.deepEqual(neck.bytes,await readFile(new URL('neck.glb',fixtures)));assert.equal(sha(final.bytes),expectedSha);
 await assert.rejects(()=>repairAshCrownPhoenixAnatomicalNeck(Buffer.from('wrong')),/Unexpected/);await assert.rejects(()=>repairAshCrownPhoenixAnatomicalLegs(Buffer.from('wrong')),/Unexpected/);
});

async function visibleSupport(path,patches=pads){
 const model=await loadPetDeformationProbe(path),mesh=model.meshes[0],restore=snapshotPetPose(model.scene),mixer=new T.AnimationMixer(model.scene);
 const bind=Object.fromEntries(Object.entries(patches).map(([name,p])=>[name,p.indices.map(v=>mesh.getVertexPosition(v,new T.Vector3()).applyMatrix4(mesh.matrixWorld))])),results=[];
 for(const name of ['attack','cast','idle_hitreact1']){
  const clip=model.animations.find(c=>c.name===name),result={name,maxDrift:0,minFloorDelta:0};
  for(let i=0;i<=480;i++){
   mixer.stopAllAction();restore();const action=mixer.clipAction(clip).reset().setLoop(T.LoopOnce,1);action.clampWhenFinished=true;action.play();action.time=i/480*clip.duration;mixer.update(0);model.update();
   for(const[name,p]of Object.entries(patches))for(const[j,v]of p.indices.entries()){const d=mesh.getVertexPosition(v,new T.Vector3()).applyMatrix4(mesh.matrixWorld).sub(bind[name][j]);result.maxDrift=Math.max(result.maxDrift,d.length());result.minFloorDelta=Math.min(result.minFloorDelta,d.y);}
  }
  results.push(result);
 }
 return results;
}

test('Ash Crown Phoenix actual source sole surfaces stay planted between keys, including the former sinking strike',async()=>{
 assert.deepEqual(Object.values(pads).map(p=>p.indices.length),[78,77]);const original=await visibleSupport(originalUrl);assert.ok(original[0].maxDrift>.3);assert.ok(original[0].minFloorDelta<-.25);
 for(const result of await visibleSupport(finalPath)){assert.ok(result.maxDrift<.0002,JSON.stringify(result));assert.ok(result.minFloorDelta>-.0002,JSON.stringify(result));}
});

async function battleSoles(){
 const path=new URL('../public/pet-models/warfront-lod/roster/mythic-10.glb',import.meta.url),model=await loadPetDeformationProbe(path),mesh=model.meshes[0],patches={};
 for(const[name,p]of Object.entries(pads)){
  const indices=[];for(let v=0;v<mesh.geometry.attributes.position.count;v++){const q=mesh.getVertexPosition(v,new T.Vector3()).applyMatrix4(mesh.matrixWorld);if(q.toArray().every((x,i)=>x>=p.worldMin[i]-.002&&x<=p.worldMax[i]+.002))indices.push(v);}
  assert.ok(indices.length>=8,name+' battle sole coverage '+indices.length);patches[name]={indices};
 }
 return{path,model,patches};
}

test('Ash Crown Phoenix battle soles remain planted inside the original visible foot boxes',async()=>{
 const{path,patches}=await battleSoles();for(const result of await visibleSupport(path,patches)){assert.ok(result.maxDrift<.0003,JSON.stringify(result));assert.ok(result.minFloorDelta>-.0003,JSON.stringify(result));}
});

test('Ash Crown Phoenix visible source and battle soles carry only their own fitted foot influence',async()=>{
 const battle=await battleSoles();for(const[model,patches]of[[await loadPetDeformationProbe(finalPath),pads],[battle.model,battle.patches]]){
  const mesh=model.meshes[0],{skinIndex,skinWeight}=mesh.geometry.attributes;
  for(const[name,p]of Object.entries(patches))for(const v of p.indices)for(let k=0;k<4;k++)if(skinWeight.getComponent(v,k)>1e-7)assert.equal(mesh.skeleton.bones[skinIndex.getComponent(v,k)].name,name==='left'?'footL':'footR');
 }
});

test('Ash Crown Phoenix source retention boundary includes every current geometry and skin stream',async()=>{
 const{json}=await loadPetDeformationProbe(finalPath),boundary=json.extras.properAnimationSourceBoundary;
 for(const index of [...json.meshes.flatMap(m=>m.primitives.flatMap(p=>[p.indices,...Object.values(p.attributes)])),...json.skins.map(s=>s.inverseBindMatrices)]){const accessor=json.accessors[index],view=json.bufferViews[accessor.bufferView],payload=view.extensions?.EXT_meshopt_compression??view;assert.ok(index<boundary.accessorCount);assert.ok(accessor.bufferView<boundary.bufferViewCount);if(payload.buffer===0)assert.ok((payload.byteOffset??0)+payload.byteLength<=boundary.binLength);}
});

test('Ash Crown Phoenix shipping source equals the reviewed anatomical recipe',async()=>{
 assert.equal(sha(await readFile(new URL('../public/pet-models/roster/mythic-10.glb',import.meta.url))),expectedSha);
});
