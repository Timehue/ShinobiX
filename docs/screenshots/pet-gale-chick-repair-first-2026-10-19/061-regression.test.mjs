import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import * as THREE from 'three';
import {repairReviewedPetSkull} from './repair-reviewed-pet-skull.mjs';
import {loadPetDeformationProbe,snapshotPetPose,petClipSampleTimes} from './lib/pet-deformation-probe.mjs';
import {assertReviewedAnimationConservation} from './lib/pet-animation-conservation.mjs';
import {createIndependentFaceProbe} from '../src/pet-independent-face-probe.ts';

const id='starter-wind',beforeUrl=new URL('./fixtures/pet-gale-chick-complete-face/starter-wind-before.glb',import.meta.url);
const recipe=JSON.parse(await readFile(new URL('./fixtures/pet-gale-chick-complete-face/recipe.json',import.meta.url))).config;
const annotation=JSON.parse(await readFile(new URL('./pet-independent-face-landmarks.json',import.meta.url))).pets[id];
const beforeSha='7db0c699890741263cddd7f65e6ccc2fe7cf8d62fe56fc5b210ae40333ef55d9';
const afterSha='b59c81236963a6ebb39e801e5c2053d707dbd8fd88f45225f54c7b0bcb92f583';
const sha=b=>createHash('sha256').update(b).digest('hex');

function sweep(model){
    const probe=createIndependentFaceProbe(model.meshes,annotation),mixer=new THREE.AnimationMixer(model.scene),restore=snapshotPetPose(model.scene);
    let clips=0,blends=0;
    for(const clip of model.animations)for(const time of petClipSampleTimes(clip,24)){
        mixer.stopAllAction();restore();const action=mixer.clipAction(clip).reset().setLoop(THREE.LoopOnce,1);
        action.clampWhenFinished=true;action.play();action.time=time;mixer.update(0);model.update();probe.measure(time);clips++;
    }
    for(const from of model.animations)for(const to of model.animations)if(from!==to)for(const blend of [.25,.5,.75]){
        mixer.stopAllAction();restore();
        for(const[clip,weight,progress]of[[from,1-blend,.75],[to,blend,.25]]){
            const action=mixer.clipAction(clip).reset().setLoop(THREE.LoopOnce,1);action.clampWhenFinished=true;
            action.setEffectiveWeight(weight).play();action.time=clip.duration*progress;
        }
        mixer.update(0);model.update();probe.measure(blend);blends++;
    }
    return {clips,blends,...probe.report()};
}

test('Gale Chick: frozen independent face landmarks detect the released jaw distortion',async()=>{
    const before=await loadPetDeformationProbe(beforeUrl);assert.equal(before.sha256,beforeSha);
    const result=sweep(before);assert.equal(result.failed,true,'The regression must detect the released defect');
    assert.ok(result.regions.some(r=>['muzzle','lowerFace','jawChin'].includes(r.name)&&r.maxDrift>.001));
});

test('Gale Chick: repair reproduces reviewed bytes while preserving sculpt, bind and every authored curve',async()=>{
    const dir=await mkdtemp(join(tmpdir(),'ripple-face-'));
    try{
        const output=join(dir,'starter-wind.glb');await repairReviewedPetSkull(id,fileURLToPath(beforeUrl),output,recipe);
        assert.equal(sha(await readFile(output)),afterSha);
        const before=await loadPetDeformationProbe(beforeUrl),after=await loadPetDeformationProbe(output);
        assert.deepEqual(after.json.nodes,before.json.nodes);
        const a=before.meshes[0],b=after.meshes[0];
        for(const name of Object.keys(a.geometry.attributes))if(!['skinIndex','skinWeight'].includes(name))assert.deepEqual(b.geometry.attributes[name].array,a.geometry.attributes[name].array,name);
        assert.deepEqual(b.geometry.index.array,a.geometry.index.array);
        a.skeleton.boneInverses.forEach((matrix,i)=>assert.deepEqual(b.skeleton.boneInverses[i].toArray(),matrix.toArray()));
        assertReviewedAnimationConservation(before,after);
        for(const clip of before.animations)for(const track of clip.tracks){
            const actual=after.animations.find(c=>c.name===clip.name).tracks.find(t=>t.name===track.name);
            assert.equal(actual.getInterpolation(),track.getInterpolation());
        }
    }finally{await rm(dir,{recursive:true,force:true});}
});

for(const stage of ['source','battle'])test(`Gale Chick ${stage}: eight independently frozen face regions survive all clips and 468 blends`,async()=>{
    const privateRoot=process.env.PET_GALE_CANDIDATE_ROOT;
    const path=privateRoot?new URL(`../${privateRoot}/${stage==='battle'?'warfront-lod/':''}starter-wind.glb`,import.meta.url):new URL(`../public/pet-models/${stage==='battle'?'warfront-lod/':''}starter-wind.glb`,import.meta.url);
    const model=await loadPetDeformationProbe(path);if(stage==='source')assert.equal(model.sha256,afterSha);
    const result=sweep(model);assert.equal(result.failed,false,JSON.stringify(result));
    assert.equal(result.clips,966);assert.equal(result.blends,468);assert.equal(result.regions.length,8);
    for(const region of result.regions){assert.ok(region.vertices>=20);assert.ok(region.edges>=3);assert.ok(region.maxDrift<.00002,region.name);}
});
