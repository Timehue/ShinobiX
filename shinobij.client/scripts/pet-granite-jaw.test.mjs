import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import * as THREE from 'three';
import {repairReviewedPetSkull} from './repair-reviewed-pet-skull.mjs';
import {loadPetDeformationProbe,snapshotPetPose} from './lib/pet-deformation-probe.mjs';
import {createIndependentFaceProbe} from '../src/pet-independent-face-probe.ts';

const fixture=fileURLToPath(new URL('./fixtures/pet-granite-jaw-20261021/original-source.glb',import.meta.url));
const recipe=JSON.parse(await readFile(new URL('./fixtures/pet-granite-jaw-20261021/recipe.json',import.meta.url)));
const annotation=JSON.parse(await readFile(new URL('./pet-independent-face-landmarks.json',import.meta.url))).pets['starter-earth-r'];
function inspect(model){
 const mixer=new THREE.AnimationMixer(model.scene),restore=snapshotPetPose(model.scene),probe=createIndependentFaceProbe(model.meshes,annotation);
 const action=(clip,time,weight=1)=>{const a=mixer.clipAction(clip).reset().setLoop(THREE.LoopOnce,1);a.clampWhenFinished=true;a.setEffectiveWeight(weight).play();a.time=clip.duration*time;};
 for(const clip of model.animations)for(let i=0;i<=24;i++){mixer.stopAllAction();restore();action(clip,i/24);mixer.update(0);model.update();probe.measure(i/24);}
 let blends=0;
 for(const from of model.animations)for(const to of model.animations)if(from!==to)for(const weight of [.25,.5,.75]){mixer.stopAllAction();restore();action(from,.75,1-weight);action(to,.25,weight);mixer.update(0);model.update();probe.measure(weight);blends++;}
 assert.equal(blends,468);mixer.stopAllAction();return probe.report();
}
test('Granite jaw repair reproduces the reviewed bytes and rejects the original facial defect across every take and blend',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'granite-jaw-'));
 try{
  const output=join(directory,'candidate.glb');
  await assert.rejects(repairReviewedPetSkull('starter-earth-r',fixture,output,{...recipe.config,supersedesSourceSha256:'0'.repeat(64)}),/pin.*reviewed source/);
  await repairReviewedPetSkull('starter-earth-r',fixture,output,recipe.config);
  assert.equal(createHash('sha256').update(await readFile(output)).digest('hex'),recipe.candidateSha256);
  const before=await loadPetDeformationProbe(fixture),after=await loadPetDeformationProbe(output);
  assert.equal(inspect(before).failed,true,'Original must still reproduce the frozen facial failure');
  assert.equal(inspect(after).failed,false,'Complete repaired face must survive all takes and 468 blends');
  for(const name of ['position','normal','uv'])assert.deepEqual(after.meshes[0].geometry.attributes[name].array,before.meshes[0].geometry.attributes[name].array,`${name}: sculpt/texture coordinates changed`);
  assert.deepEqual(after.meshes[0].geometry.index.array,before.meshes[0].geometry.index.array);
  const motion=clips=>clips.map(c=>{const {uuid,...data}=c.toJSON();return data;});
  assert.deepEqual(motion(after.animations),motion(before.animations),'Authored motion changed');
  assert.deepEqual(after.meshes[0].skeleton.boneInverses.map(m=>m.elements),before.meshes[0].skeleton.boneInverses.map(m=>m.elements));
 }finally{await rm(directory,{recursive:true,force:true});}
});
