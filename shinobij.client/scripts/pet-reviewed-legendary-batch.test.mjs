import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import * as T from 'three';
import {createIndependentFaceProbe} from '../src/pet-independent-face-probe.ts';
import {loadPetDeformationProbe,snapshotPetPose,petClipSampleTimes} from './lib/pet-deformation-probe.mjs';
import {petFaceGeometryFingerprint} from './lib/pet-face-geometry-fingerprint.mjs';
import {assertReviewedAnimationConservation} from './lib/pet-animation-conservation.mjs';
import {repairReviewedPetSkull} from './repair-reviewed-pet-skull.mjs';

const ids=[...[5,6,7,8,9,10,11,12,14,16,18,19,20,21,22,25].map(n=>'legendary-'+n),'standard-0'];
const annotations=JSON.parse(await readFile(new URL('./pet-independent-face-landmarks.json',import.meta.url))).pets;
const repairs=JSON.parse(await readFile(new URL('./pet-complete-face-repairs.json',import.meta.url))).pets;
const original=id=>new URL(`./fixtures/pet-complete-face-20261015/${id}-v1.glb`,import.meta.url);
const intermediate={
    'legendary-7':'pet-moon-serpent-coordinated-actions',
    'legendary-8':'pet-storm-lion-coordinated-actions',
    'legendary-11':'pet-thunder-drake-supported-neck',
    'legendary-19':'pet-frost-wyrm-tail-clearance',
    'legendary-20':'pet-kraken-supported-actions',
    'legendary-25':'pet-storm-wyvern-supported-neck',
};
function sweep(model,annotation){
    const probe=createIndependentFaceProbe(model.meshes,annotation),restore=snapshotPetPose(model.scene),mixer=new T.AnimationMixer(model.scene);
    const pose=(clip,time,weight=1)=>{const a=mixer.clipAction(clip).reset().setLoop(T.LoopOnce,1);a.clampWhenFinished=true;a.setEffectiveWeight(weight).play();a.time=time;};
    let clips=0,blends=0;
    for(const clip of model.animations){clips++;for(const t of petClipSampleTimes(clip,24)){mixer.stopAllAction();restore();pose(clip,t);mixer.update(0);model.update();probe.measure(t);}}
    for(const from of model.animations)for(const to of model.animations)if(from!==to)for(const b of [.25,.5,.75]){mixer.stopAllAction();restore();pose(from,from.duration*.75,1-b);pose(to,to.duration*.25,b);mixer.update(0);model.update();probe.measure(b);blends++;}
    mixer.stopAllAction();return {...probe.report(),clips,blends};
}
for(const id of ids){
    for(const stage of ['roster','warfront-lod/roster'])test(`${id} ${stage}: frozen complete-face coverage survives all 13 takes and 468 blends`,async()=>{
        const m=await loadPetDeformationProbe(new URL(`../public/pet-models/${stage}/${id}.glb`,import.meta.url));
        try{const result=sweep(m,annotations[id]);assert.equal(result.clips,13);assert.equal(result.blends,468);assert.equal(result.failed,false,JSON.stringify(result));}
        finally{m.meshes.forEach(mesh=>mesh.geometry.dispose());}
    });
    if(!repairs[id])continue;
    test(`${id}: the same independent landmarks reject its original facial distortion`,async()=>{
        const m=await loadPetDeformationProbe(original(id));
        try{assert.equal(m.sha256,annotations[id].sourceSha256);const result=sweep(m,annotations[id]);assert.equal(result.failed,true);assert.ok(result.regions.some(r=>r.name!=='upperFace'&&r.maxDrift>.00002));}
        finally{m.meshes.forEach(mesh=>mesh.geometry.dispose());}
    });
    test(`${id}: pinned facial binding replays exactly without altering sculpt, rig or unrelated curves`,async()=>{
        const dir=await mkdtemp(join(tmpdir(),'reviewed-legendary-face-'));let before,after;
        try{
            const destination=join(dir,'face.glb');await repairReviewedPetSkull(id,fileURLToPath(original(id)),destination,repairs[id]);
            const expected=intermediate[id]?new URL(`./fixtures/${intermediate[id]}/${id}.glb`,import.meta.url):new URL(`../public/pet-models/roster/${id}.glb`,import.meta.url);
            assert.deepEqual(await readFile(destination),await readFile(expected));
            before=await loadPetDeformationProbe(original(id));after=await loadPetDeformationProbe(destination);
            assert.equal(petFaceGeometryFingerprint(after),petFaceGeometryFingerprint(before));assert.deepEqual(after.json.nodes,before.json.nodes);assertReviewedAnimationConservation(before,after,repairs[id].animationClearance);
        }finally{for(const m of [before,after])m?.meshes.forEach(mesh=>mesh.geometry.dispose());await rm(dir,{recursive:true,force:true});}
    });
}
