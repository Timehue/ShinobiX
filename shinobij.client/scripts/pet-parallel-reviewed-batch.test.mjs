import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import * as THREE from 'three';
import {createIndependentFaceProbe} from '../src/pet-independent-face-probe.ts';
import {loadPetDeformationProbe,snapshotPetPose,petClipSampleTimes} from './lib/pet-deformation-probe.mjs';
import {petFaceGeometryFingerprint} from './lib/pet-face-geometry-fingerprint.mjs';
import {assertReviewedAnimationConservation} from './lib/pet-animation-conservation.mjs';
import {repairReviewedPetSkull} from './repair-reviewed-pet-skull.mjs';
import {calibratePetVisibleGround} from './lib/pet-visible-ground-calibration.mjs';

const selection=JSON.parse(await readFile(new URL('../../docs/audits/pet-parallel-reviewed-batch-selection-2026-10-20.json',import.meta.url)));
const annotations=JSON.parse(await readFile(new URL('./pet-independent-face-landmarks.json',import.meta.url))).pets;
const repairs=JSON.parse(await readFile(new URL('./pet-complete-face-repairs.json',import.meta.url))).pets;
const manifest=JSON.parse(await readFile(new URL('../public/pet-models/warfront-impostors/manifest.json',import.meta.url))).entries;
const sha=b=>createHash('sha256').update(b).digest('hex');
const publicFile=path=>new URL('../public'+path.split('?')[0],import.meta.url);
function sweep(model,annotation){
 const probe=createIndependentFaceProbe(model.meshes,annotation),mixer=new THREE.AnimationMixer(model.scene),restore=snapshotPetPose(model.scene);
 for(const clip of model.animations)for(const time of petClipSampleTimes(clip,24)){
  mixer.stopAllAction();restore();const action=mixer.clipAction(clip).reset().setLoop(THREE.LoopOnce,1);action.clampWhenFinished=true;action.play();action.time=time;mixer.update(0);model.update();probe.measure(time);
 }
 let blends=0;
 for(const from of model.animations)for(const to of model.animations)if(from!==to)for(const blend of [.25,.5,.75]){
  mixer.stopAllAction();restore();for(const[clip,weight,progress]of [[from,1-blend,.75],[to,blend,.25]]){const action=mixer.clipAction(clip).reset().setLoop(THREE.LoopOnce,1);action.clampWhenFinished=true;action.setEffectiveWeight(weight).play();action.time=clip.duration*progress;}mixer.update(0);model.update();probe.measure(blend);blends++;
 }
 assert.equal(blends,468);mixer.stopAllAction();restore();model.update();return probe.report();
}
for(const row of selection.selected){
 const asset=manifest.find(e=>e.sourceUrl.endsWith('/'+row.id+'.glb'));assert.ok(asset,row.id);
 for(const[stage,path,expected]of [['source',asset.sourceUrl,row.sha256],['battle',asset.lodUrl,row.lodSha256]])test(`${row.id} ${stage}: frozen independent anatomy passes all 13 clips and 468 transitions`,async()=>{
  const model=await loadPetDeformationProbe(publicFile(path));assert.equal(model.sha256,expected);assert.equal(model.animations.length,13);
  if(stage==='source')assert.equal(petFaceGeometryFingerprint(model),annotations[row.id].geometrySha256);
  assert.equal(sweep(model,annotations[row.id]).failed,false,row.id+' '+stage);
 });
 test(`${row.id}: reviewed atlas fingerprint remains exact`,async()=>assert.equal(sha(await readFile(publicFile(asset.atlasUrl))),row.atlasSha256));
 if(!selection.changedSourceIds.includes(row.id))continue;
 test(`${row.id}: immutable original and reviewed repair reproduce the shipped bytes`,async()=>{
  const directory=await mkdtemp(join(tmpdir(),'pet-reviewed-batch-'));
  try{
   const input=new URL(`./fixtures/pet-complete-face-20261015/${row.id}-v1.glb`,import.meta.url),destination=join(directory,'face.glb');
   const original=await loadPetDeformationProbe(input);assert.equal(original.sha256,annotations[row.id].sourceSha256);
   await repairReviewedPetSkull(row.id,fileURLToPath(input),destination,repairs[row.id]);
   const repaired=await loadPetDeformationProbe(destination);assert.equal(petFaceGeometryFingerprint(repaired),petFaceGeometryFingerprint(original));assert.deepEqual(repaired.json.nodes,original.json.nodes);assertReviewedAnimationConservation(original,repaired,repairs[row.id].animationClearance);
   if(['rare-29','rare-31'].includes(row.id)){
    const baseline=new URL(`./fixtures/pet-visible-ground-20261020/${row.id}-source.glb`,import.meta.url);assert.deepEqual(await readFile(destination),await readFile(baseline));
    const sourceOutput=join(directory,'source.glb'),battleOutput=join(directory,'battle.glb');await calibratePetVisibleGround({id:row.id,sourcePath:destination,battlePath:fileURLToPath(new URL(`./fixtures/pet-visible-ground-20261020/${row.id}-battle.glb`,import.meta.url)),sourceOutput,battleOutput});
    assert.equal(sha(await readFile(sourceOutput)),row.sha256);assert.equal(sha(await readFile(battleOutput)),row.lodSha256);
   }else assert.equal(repaired.sha256,row.sha256);
  }finally{await rm(directory,{recursive:true,force:true});}
 });
}
