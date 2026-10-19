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

const id='starter-water',beforeUrl=new URL('./fixtures/pet-ripple-seal-complete-face/starter-water-before.glb',import.meta.url);
const recipe=JSON.parse(await readFile(new URL('./fixtures/pet-ripple-seal-complete-face/recipe.json',import.meta.url))).config;
const annotation=JSON.parse(await readFile(new URL('./pet-independent-face-landmarks.json',import.meta.url))).pets[id];
const beforeSha='d4b09247b2ad1ada7c179771d631b2bd833f02d917bb082950011454df2ca036';
const afterSha='90150dd50ff366a8e6504448c2a857ca8c20214e5cfe8e0fd1973fa921e521eb';
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

test('Ripple Seal: frozen independent face landmarks detect the released jaw distortion',async()=>{
    const before=await loadPetDeformationProbe(beforeUrl);assert.equal(before.sha256,beforeSha);
    const result=sweep(before);assert.equal(result.failed,true,'The regression must detect the released defect');
    assert.ok(result.regions.some(r=>['muzzle','lowerFace','jawChin'].includes(r.name)&&r.maxDrift>.001));
});

test('Ripple Seal: repair reproduces reviewed bytes while preserving sculpt, bind and every authored curve',async()=>{
    const dir=await mkdtemp(join(tmpdir(),'ripple-face-'));
    try{
        const output=join(dir,'starter-water.glb');await repairReviewedPetSkull(id,fileURLToPath(beforeUrl),output,recipe);
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

for(const stage of ['source','battle'])test(`Ripple Seal ${stage}: seven independently frozen face regions survive all clips and 468 blends`,async()=>{
    const privateRoot=process.env.PET_RIPPLE_CANDIDATE_ROOT;
    const path=privateRoot?new URL(`../${privateRoot}/${stage==='battle'?'warfront-lod/':''}starter-water.glb`,import.meta.url):new URL(`../public/pet-models/${stage==='battle'?'warfront-lod/':''}starter-water.glb`,import.meta.url);
    const model=await loadPetDeformationProbe(path);if(stage==='source')assert.equal(model.sha256,afterSha);
    const result=sweep(model);assert.equal(result.failed,false,JSON.stringify(result));
    assert.equal(result.clips,570);assert.equal(result.blends,468);assert.equal(result.regions.length,7);
    for(const region of result.regions){assert.ok(region.vertices>=20);assert.ok(region.edges>=3);assert.ok(region.maxDrift<.00002,region.name);}
});
