import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import * as THREE from 'three';
import {repairReviewedPetSkull} from './repair-reviewed-pet-skull.mjs';
import {repairSparkPupRootClearance} from './repair-spark-pup-root-clearance.mjs';
import {loadPetDeformationProbe,snapshotPetPose,petClipSampleTimes} from './lib/pet-deformation-probe.mjs';
import {createIndependentFaceProbe} from '../src/pet-independent-face-probe.ts';

const id='starter-lightning';
const beforeUrl=new URL('./fixtures/pet-spark-pup-complete-face/starter-lightning-before.glb',import.meta.url);
const recipe=JSON.parse(await readFile(new URL('./fixtures/pet-spark-pup-complete-face/recipe.json',import.meta.url)));
const annotation=JSON.parse(await readFile(new URL('./pet-independent-face-landmarks.json',import.meta.url))).pets[id];
const sha=b=>createHash('sha256').update(b).digest('hex');
const rootClips=['attack','cast','idle_hitreact1'];
const asset=stage=>new URL(`../${process.env.PET_SPARK_CANDIDATE_ROOT??'public/pet-models'}/${stage==='battle'?'warfront-lod/':''}${id}.glb`,import.meta.url);

function sweep(model){
    const probe=createIndependentFaceProbe(model.meshes,annotation);
    const mixer=new THREE.AnimationMixer(model.scene),restore=snapshotPetPose(model.scene);
    let clips=0,blends=0;
    for(const clip of model.animations)for(const time of petClipSampleTimes(clip,24)){
        mixer.stopAllAction();restore();
        const action=mixer.clipAction(clip).reset().setLoop(THREE.LoopOnce,1);
        action.clampWhenFinished=true;action.play();action.time=time;
        mixer.update(0);model.update();probe.measure(time);clips++;
    }
    for(const from of model.animations)for(const to of model.animations)if(from!==to)for(const blend of [.25,.5,.75]){
        mixer.stopAllAction();restore();
        for(const[clip,weight,progress]of[[from,1-blend,.75],[to,blend,.25]]){
            const action=mixer.clipAction(clip).reset().setLoop(THREE.LoopOnce,1);
            action.clampWhenFinished=true;action.setEffectiveWeight(weight).play();action.time=clip.duration*progress;
        }
        mixer.update(0);model.update();probe.measure(blend);blends++;
    }
    return {clips,blends,...probe.report()};
}

// This verifier measures the entire posed surface at offset times, independently
// of the repair's 240 Hz key fitting, masks, lift samples and interpolation code.
function groundSweep(model,names,frequency=480){
    const mesh=model.meshes[0],mixer=new THREE.AnimationMixer(model.scene);
    const restore=snapshotPetPose(model.scene),point=new THREE.Vector3();
    const minimum=()=>{
        let y=Infinity;
        for(let v=0;v<mesh.geometry.attributes.position.count;v++){
            y=Math.min(y,mesh.getVertexPosition(v,point).applyMatrix4(mesh.matrixWorld).y);
        }
        return y;
    };
    const floor=minimum(),reports=[];
    for(const name of names){
        const clip=model.animations.find(c=>c.name===name);assert.ok(clip,name);
        const steps=Math.ceil(clip.duration*frequency);let clearance=Infinity;
        for(let i=0;i<=steps;i++){
            mixer.stopAllAction();restore();
            const action=mixer.clipAction(clip).reset().setLoop(THREE.LoopOnce,1);
            action.clampWhenFinished=true;action.play();action.time=clip.duration*(i+.37)/(steps+1);
            mixer.update(0);model.update();clearance=Math.min(clearance,minimum()-floor);
        }
        reports.push({name,clearance});
    }
    return reports;
}

test('Spark Pup: original independent face landmarks detect the released mask distortion',async()=>{
    const model=await loadPetDeformationProbe(beforeUrl);assert.equal(model.sha256,recipe.beforeSha256);
    const result=sweep(model);assert.equal(result.failed,true);
    assert.ok(result.regions.some(r=>['lowerFace','lowerMaskRim','maskLeftRim','maskRightRim'].includes(r.name)&&r.maxDrift>.01));
});

test('Spark Pup: measured repair reproduces reviewed bytes and retains the sculpt, bind and authored articulation',async()=>{
    const dir=await mkdtemp(join(tmpdir(),'spark-face-contact-'));
    try{
        const face=join(dir,'face.glb'),output=join(dir,'complete.glb');
        await repairReviewedPetSkull(id,fileURLToPath(beforeUrl),face,recipe.config);
        assert.equal(sha(await readFile(face)),recipe.faceOnlySha256);
        await repairSparkPupRootClearance(face,output);
        assert.equal(sha(await readFile(output)),recipe.sha256);
        const before=await loadPetDeformationProbe(beforeUrl),after=await loadPetDeformationProbe(output);
        assert.deepEqual(after.json.nodes,before.json.nodes);
        assert.equal(after.animations.length,before.animations.length);
        const a=before.meshes[0],b=after.meshes[0];
        for(const name of Object.keys(a.geometry.attributes))if(!['skinIndex','skinWeight'].includes(name)){
            assert.deepEqual(b.geometry.attributes[name].array,a.geometry.attributes[name].array,name);
        }
        assert.deepEqual(b.geometry.index.array,a.geometry.index.array);
        a.skeleton.boneInverses.forEach((matrix,i)=>assert.deepEqual(b.skeleton.boneInverses[i].toArray(),matrix.toArray()));
        for(const clip of before.animations){
            const actual=after.animations.find(c=>c.name===clip.name);
            assert.equal(actual.duration,clip.duration);assert.equal(actual.tracks.length,clip.tracks.length);
            for(const track of clip.tracks){
                const next=actual.tracks.find(t=>t.name===track.name);assert.ok(next);
                assert.equal(next.getInterpolation(),track.getInterpolation());
                if(rootClips.includes(clip.name)&&track.name==='root.position'){
                    const original=track.createInterpolant(),corrected=next.createInterpolant();
                    for(let i=0;i<173;i++){
                        const t=clip.duration*(i+.61)/173,a=original.evaluate(t),b=corrected.evaluate(t);
                        for(const axis of [0,2])assert.ok(Math.abs(a[axis]-b[axis])<3e-7);
                        assert.ok(b[1]>=a[1]-3e-7);
                    }
                }else{
                    assert.deepEqual(next.times,track.times);assert.deepEqual(next.values,track.values);
                }
            }
        }
    }finally{await rm(dir,{recursive:true,force:true});}
});

test('Spark Pup: independent full-surface measurement detects original authored paw penetration',async()=>{
    const model=await loadPetDeformationProbe(beforeUrl);
    const result=groundSweep(model,rootClips);
    assert.ok(result.every(r=>r.clearance<-.02),JSON.stringify(result));
});

for(const stage of ['source','battle']){
    test(`Spark Pup ${stage}: twelve independent face regions survive every clip and 468 blends`,async()=>{
        const model=await loadPetDeformationProbe(asset(stage));
        if(stage==='source')assert.equal(model.sha256,recipe.sha256);
        const result=sweep(model);assert.equal(result.failed,false,JSON.stringify(result));
        assert.ok(result.clips>=600);assert.equal(result.blends,468);assert.equal(result.regions.length,12);
        for(const region of result.regions){
            assert.ok(region.vertices>=20);assert.ok(region.edges>=3);assert.ok(region.maxDrift<.00002,region.name);
        }
    });
    test(`Spark Pup ${stage}: attack, cast and recoil retain ground clearance at independent offset times`,async()=>{
        const model=await loadPetDeformationProbe(asset(stage));
        const result=groundSweep(model,rootClips);
        assert.ok(result.every(r=>r.clearance>=-.0005),JSON.stringify(result));
        assert.equal(model.json.extras.characterMotion.plantedAttack,true);
        assert.equal(model.json.extras.characterMotion.plantedRecoil,true);
    });
}
