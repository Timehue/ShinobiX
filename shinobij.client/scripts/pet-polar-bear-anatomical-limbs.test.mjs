import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import * as THREE from 'three';
import {repairReviewedPetSkull} from './repair-reviewed-pet-skull.mjs';
import {repairPolarBearAnatomicalLimbs} from './lib/pet-polar-bear-anatomical-limbs.mjs';
import {repairPolarBearAnatomicalCoordinatedActions} from './lib/pet-polar-bear-coordinated-actions.mjs';
import {retargetFittedPetPerformances} from './lib/pet-retarget-fitted-performances.mjs';
import {loadPetDeformationProbe,snapshotPetPose,petClipSampleTimes} from './lib/pet-deformation-probe.mjs';
import {createIndependentFaceProbe} from '../src/pet-independent-face-probe.ts';
import {createCharacterRig,readCharacterTake,finishCharacterTake} from './lib/pet-character-motion.mjs';
import {parseStudioGlb} from './lib/pet-studio-glb.mjs';

const originalUrl=new URL('./fixtures/pet-complete-face-20261015/legendary-13-v1.glb',import.meta.url);
const faceUrl=new URL('./fixtures/pet-polar-bear-anatomical-limbs/legendary-13.glb',import.meta.url);
const gaitUrl=new URL('./fixtures/pet-polar-bear-coordinated-actions/legendary-13.glb',import.meta.url);
const faceBytes=await readFile(faceUrl),gaits=await repairPolarBearAnatomicalLimbs(faceBytes),final=await repairPolarBearAnatomicalCoordinatedActions(gaits.bytes);
const expectedSha='99b8e9ddd07c7d2de5142f06dd68acc370d14d97b9bb24b63ab7bbea335a5d6a';
const annotation=JSON.parse(await readFile(new URL('./pet-independent-face-landmarks.json',import.meta.url))).pets['legendary-13'];
const repairs=JSON.parse(await readFile(new URL('./pet-complete-face-repairs.json',import.meta.url))).pets['legendary-13'];
const pads=JSON.parse(await readFile(new URL('./fixtures/pet-polar-bear-anatomical-limbs/visible-paw-landmarks.json',import.meta.url))).patches;
const temp=await mkdtemp(join(tmpdir(),'polar-bear-regression-')),finalPath=join(temp,'final.glb');
await writeFile(finalPath,final.bytes);
test.after(async()=>{await rm(temp,{recursive:true,force:true});});

function sweepFace(model){
 const probe=createIndependentFaceProbe(model.meshes,annotation),restore=snapshotPetPose(model.scene),mixer=new THREE.AnimationMixer(model.scene);
 for(const clip of model.animations)for(const time of petClipSampleTimes(clip,24)){
  mixer.stopAllAction();restore();const action=mixer.clipAction(clip).reset().setLoop(THREE.LoopOnce,1);action.clampWhenFinished=true;action.play();action.time=time;mixer.update(0);model.update();probe.measure(time);
 }
 for(const from of model.animations)for(const to of model.animations)if(from!==to)for(const blend of [.25,.5,.75]){
  mixer.stopAllAction();restore();for(const[c,w,p]of [[from,1-blend,.75],[to,blend,.25]]){const action=mixer.clipAction(c).reset().setLoop(THREE.LoopOnce,1);action.clampWhenFinished=true;action.setEffectiveWeight(w).play();action.time=c.duration*p;}mixer.update(0);model.update();probe.measure(blend);
 }
 return probe.report();
}

test('Polar Bear frozen facial landmarks detect the released defect and pass the anatomical candidate',async()=>{
 const original=await loadPetDeformationProbe(originalUrl);assert.equal(original.sha256,annotation.sourceSha256);assert.equal(sweepFace(original).failed,true);
 const candidate=await loadPetDeformationProbe(finalPath),result=sweepFace(candidate);assert.equal(result.failed,false,JSON.stringify(result));
 assert.deepEqual(Object.keys(annotation.landmarks),['upperFace','muzzle','lowerFace','jawChin']);
});

test('Polar Bear adds limb joints without changing sculpt, textures, original bone frames or unrelated curves',async()=>{
 const before=await loadPetDeformationProbe(faceUrl),after=await loadPetDeformationProbe(finalPath),a=before.meshes[0],b=after.meshes[0];
 for(const name of ['position','normal','uv'])assert.deepEqual(a.geometry.attributes[name].array,b.geometry.attributes[name].array,name);assert.deepEqual(a.geometry.index.array,b.geometry.index.array);
 assert.equal(b.skeleton.bones.length,a.skeleton.bones.length+12);
 for(const[i,m]of a.skeleton.boneInverses.entries())assert.deepEqual(m.toArray(),b.skeleton.boneInverses[i].toArray());
 for(const[i,node]of before.json.nodes.entries()){const next=structuredClone(after.json.nodes[i]);if(node.children)next.children=next.children.filter(id=>id<before.json.nodes.length);else delete next.children;assert.deepEqual(next,node);}
 assert.deepEqual(after.json.materials,before.json.materials);assert.deepEqual(after.json.textures,before.json.textures);
 for(const[i,img]of before.json.images.entries()){const x=before.json.bufferViews[img.bufferView],y=after.json.bufferViews[after.json.images[i].bufferView];assert.deepEqual(before.binary.subarray(x.byteOffset,x.byteOffset+x.byteLength),after.binary.subarray(y.byteOffset,y.byteOffset+y.byteLength));}
 let restDrift=0;for(let v=0;v<a.geometry.attributes.position.count;v++)restDrift=Math.max(restDrift,a.getVertexPosition(v,new THREE.Vector3()).applyMatrix4(a.matrixWorld).distanceTo(b.getVertexPosition(v,new THREE.Vector3()).applyMatrix4(b.matrixWorld)));assert.ok(restDrift<.00001,`Float32 inverse-bind rest drift: ${restDrift}`);
 for(const[cIndex,c]of before.animations.entries()){const d=after.animations[cIndex];assert.equal(c.name,d.name);assert.equal(c.duration,d.duration);for(const t of c.tracks){const u=d.tracks.find(u=>u.name===t.name);assert.ok(u);const allowed=(['idle','walk','gallop','guard','rest'].includes(c.name)&&t.name==='root.position')||(['attack','cast','idle_hitreact1'].includes(c.name)&&['root.position','spine.quaternion','chest.quaternion','pelvis.quaternion'].includes(t.name));if(!allowed){assert.deepEqual(u.times,t.times,c.name+'/'+t.name);assert.deepEqual(u.values,t.values,c.name+'/'+t.name);}}}
});

async function visibleSupport(path){
 const m=await loadPetDeformationProbe(path),mesh=m.meshes[0],restore=snapshotPetPose(m.scene),mixer=new THREE.AnimationMixer(m.scene),bind=Object.fromEntries(Object.entries(pads).map(([n,p])=>[n,p.indices.map(v=>mesh.getVertexPosition(v,new THREE.Vector3()).applyMatrix4(mesh.matrixWorld))])),result=[];
 for(const name of ['attack','cast','idle_hitreact1']){const clip=m.animations.find(c=>c.name===name),r={name,maxSupportDrift:0,minFloorDelta:0,swipeLift:0};for(let i=0;i<=480;i++){mixer.stopAllAction();restore();const action=mixer.clipAction(clip).reset().setLoop(THREE.LoopOnce,1);action.clampWhenFinished=true;action.play();action.time=i/480*clip.duration;mixer.update(0);m.update();for(const[n,p]of Object.entries(pads))for(const[j,v]of p.indices.entries()){const delta=mesh.getVertexPosition(v,new THREE.Vector3()).applyMatrix4(mesh.matrixWorld).sub(bind[n][j]);r.minFloorDelta=Math.min(r.minFloorDelta,delta.y);if(name==='attack'&&n==='frontL')r.swipeLift=Math.max(r.swipeLift,delta.y);else r.maxSupportDrift=Math.max(r.maxSupportDrift,delta.length());}}result.push(r);}return result;
}

test('Polar Bear visible sole vertices stay supported between keys, independently of bone-contact reports',async()=>{
 assert.deepEqual(Object.values(pads).map(p=>p.indices.length),[288,331,654,567]);
 const original=await visibleSupport(faceUrl);assert.ok(original[0].maxSupportDrift>.2);assert.ok(original[0].minFloorDelta<-.12);
 const candidate=await visibleSupport(finalPath);for(const r of candidate){assert.ok(r.maxSupportDrift<.0003,JSON.stringify(r));assert.ok(r.minFloorDelta>-.0003,JSON.stringify(r));}assert.ok(candidate[0].swipeLift>.05&&candidate[0].swipeLift<.06,JSON.stringify(candidate[0]));
});

test('Polar Bear gait stride adjustment leaves the existing default builder output unchanged',async()=>{
 const{json,bin}=parseStudioGlb(faceBytes),rig=createCharacterRig(json),take=await readCharacterTake(json,bin,json.animations.find(c=>c.name==='walk'));
 const unchanged=finishCharacterTake(rig,take,'walk','armored'),explicit=finishCharacterTake(rig,take,'walk','armored',false,1);assert.deepEqual(unchanged,explicit);assert.throws(()=>finishCharacterTake(rig,take,'walk','armored',false,0),/Invalid gait stride scale/);
});

test('Polar Bear three-stage recipe exactly reproduces the reviewed candidate and rejects other sources',async()=>{
 const dest=join(temp,'face.glb');await repairReviewedPetSkull('legendary-13',fileURLToPath(originalUrl),dest,repairs);assert.deepEqual(await readFile(dest),faceBytes);assert.deepEqual(gaits.bytes,await readFile(gaitUrl));assert.equal(createHash('sha256').update(final.bytes).digest('hex'),expectedSha);
 assert.deepEqual((await repairPolarBearAnatomicalLimbs(faceBytes)).bytes,gaits.bytes);assert.deepEqual((await repairPolarBearAnatomicalCoordinatedActions(gaits.bytes)).bytes,final.bytes);
 await assert.rejects(()=>repairPolarBearAnatomicalLimbs(Buffer.from('wrong')),/Unexpected Polar Bear/);await assert.rejects(()=>repairPolarBearAnatomicalCoordinatedActions(Buffer.from('wrong')),/Unexpected Polar Bear/);
});

test('Polar Bear shipping source reproduces the anatomical stages and restored original limb performances',async()=>{
 const shipping=await readFile(new URL('../public/pet-models/roster/legendary-13.glb',import.meta.url));
 assert.equal(createHash('sha256').update(final.bytes).digest('hex'),expectedSha);
 const restored=await retargetFittedPetPerformances(final.bytes,{expectedSha256:expectedSha});
 assert.equal(restored.report.sha256,'ace7249f33d8223b8d87fb1b0abedf60e6be96ffca1fd33495826e701a54939d');
 assert.deepEqual(shipping,restored.bytes);
});
