import test from 'node:test';import assert from 'node:assert/strict';import{readFile,mkdtemp,rm}from'node:fs/promises';import{tmpdir}from'node:os';import{join}from'node:path';import{fileURLToPath}from'node:url';import*as THREE from'three';import{createIndependentFaceProbe}from'../src/pet-independent-face-probe.ts';import{loadPetDeformationProbe,snapshotPetPose,petClipSampleTimes}from'./lib/pet-deformation-probe.mjs';import{repairReviewedPetSkull}from'./repair-reviewed-pet-skull.mjs';import{assertReviewedAnimationConservation}from'./lib/pet-animation-conservation.mjs';import{petFaceGeometryFingerprint}from'./lib/pet-face-geometry-fingerprint.mjs';
const annotations=JSON.parse(await readFile(new URL('./pet-independent-face-landmarks.json',import.meta.url))).pets,repairs=JSON.parse(await readFile(new URL('./pet-complete-face-repairs.json',import.meta.url))).pets,fixture=id=>new URL('./fixtures/pet-complete-face-20261015/'+id+'-v1.glb',import.meta.url);
function sweep(model,annotation,blends=false){
    const probe=createIndependentFaceProbe(model.meshes,annotation),mixer=new THREE.AnimationMixer(model.scene),restore=snapshotPetPose(model.scene);
    for(const clip of model.animations)for(const time of petClipSampleTimes(clip,24)){
        mixer.stopAllAction();restore();const action=mixer.clipAction(clip).reset().setLoop(THREE.LoopOnce,1);action.clampWhenFinished=true;action.play();action.time=time;mixer.update(0);model.update();probe.measure(time);
    }
    if(blends)for(const from of model.animations)for(const to of model.animations)if(from!==to)for(const blend of [.25,.5,.75]){
        mixer.stopAllAction();restore();for(const[clip,weight,progress]of[[from,1-blend,.75],[to,blend,.25]]){const action=mixer.clipAction(clip).reset().setLoop(THREE.LoopOnce,1);action.clampWhenFinished=true;action.setEffectiveWeight(weight).play();action.time=clip.duration*progress;}
        mixer.update(0);model.update();probe.measure(blend);
    }
    return probe.report();
}

for(const id of ['mythic-7','mythic-8','mythic-9']){
 test(id+': original independent face patches detect the released distortion',async()=>{const original=await loadPetDeformationProbe(fixture(id));assert.equal(original.sha256,annotations[id].sourceSha256);assert.equal(sweep(original,annotations[id],true).failed,true);});
 for(const stage of ['roster','warfront-lod/roster'])test(id+' '+stage+': complete face passes every clip and 468 blends',async()=>{const model=await loadPetDeformationProbe(new URL('../public/pet-models/'+stage+'/'+id+'.glb',import.meta.url));assert.equal(sweep(model,annotations[id],true).failed,false);});
 test(id+': pinned repair preserves sculpture, rig and authored curves and reproduces shipping bytes',async()=>{const dir=await mkdtemp(join(tmpdir(),'mythic-face-replay-'));try{const destination=join(dir,'repaired.glb');await repairReviewedPetSkull(id,fileURLToPath(fixture(id)),destination,repairs[id]);const before=await loadPetDeformationProbe(fixture(id)),after=await loadPetDeformationProbe(destination),shipping=await loadPetDeformationProbe(new URL('../public/pet-models/roster/'+id+'.glb',import.meta.url));assert.equal(after.sha256,shipping.sha256);assert.equal(petFaceGeometryFingerprint(before),petFaceGeometryFingerprint(after));assert.deepEqual(before.json.nodes,after.json.nodes);assertReviewedAnimationConservation(before,after);}finally{await rm(dir,{recursive:true,force:true});}});
}
test('mythic-7: frozen shell, outer wings and lower body retain their original palettes',async()=>{
    const before=await loadPetDeformationProbe(fixture('mythic-7')),after=await loadPetDeformationProbe(new URL('../public/pet-models/roster/mythic-7.glb',import.meta.url)),a=before.meshes[0].geometry.attributes,b=after.meshes[0].geometry.attributes,frame=new THREE.Matrix4().fromArray(annotations['mythic-7'].geometryToVisibleBind),point=new THREE.Vector3();
    let protectedCount=0;
    for(let v=0;v<a.position.count;v++){
        point.fromBufferAttribute(a.position,v).applyMatrix4(frame);
        if(point.y<=.08||point.z<=.08||Math.abs(point.x)>=.56){
            for(let k=0;k<4;k++){assert.equal(b.skinIndex.getComponent(v,k),a.skinIndex.getComponent(v,k));assert.equal(b.skinWeight.getComponent(v,k),a.skinWeight.getComponent(v,k));}
            protectedCount++;
        }
    }
    assert.ok(protectedCount>10000,'Original shell, wings and lower body need independent coverage');
});

test('mythic-8: frozen arms, legs and lower torso retain their original palettes',async()=>{
 const before=await loadPetDeformationProbe(fixture('mythic-8')),after=await loadPetDeformationProbe(new URL('../public/pet-models/roster/mythic-8.glb',import.meta.url)),a=before.meshes[0].geometry.attributes,b=after.meshes[0].geometry.attributes,frame=new THREE.Matrix4().fromArray(annotations['mythic-8'].geometryToVisibleBind),point=new THREE.Vector3();let protectedCount=0;
 const palette=(attrs,v)=>{const values=Array(before.meshes[0].skeleton.bones.length).fill(0);for(let k=0;k<4;k++)values[attrs.skinIndex.getComponent(v,k)]+=attrs.skinWeight.getComponent(v,k);return values;};
 for(let v=0;v<a.position.count;v++){point.fromBufferAttribute(a.position,v).applyMatrix4(frame);if(point.y<=.08||Math.abs(point.x)>=.56){assert.deepEqual(palette(b,v),palette(a,v),'Body binding changed at '+v);protectedCount++;}}
 assert.ok(protectedCount>5000,'Original limbs and lower torso need independent coverage');
});

test('mythic-9: frozen branch arms, root feet and lower trunk retain their original palettes',async()=>{
 const before=await loadPetDeformationProbe(fixture('mythic-9')),after=await loadPetDeformationProbe(new URL('../public/pet-models/roster/mythic-9.glb',import.meta.url)),a=before.meshes[0].geometry.attributes,b=after.meshes[0].geometry.attributes,frame=new THREE.Matrix4().fromArray(annotations['mythic-9'].geometryToVisibleBind),point=new THREE.Vector3();let protectedCount=0;
 const palette=(attrs,v)=>{const values=Array(before.meshes[0].skeleton.bones.length).fill(0);for(let k=0;k<4;k++)values[attrs.skinIndex.getComponent(v,k)]+=attrs.skinWeight.getComponent(v,k);return values;};
 for(let v=0;v<a.position.count;v++){point.fromBufferAttribute(a.position,v).applyMatrix4(frame);if(point.y<=-.35||Math.abs(point.x)>=.45){assert.deepEqual(palette(b,v),palette(a,v),'Body binding changed at '+v);protectedCount++;}}
 assert.ok(protectedCount>5000,'Original limbs and lower torso need independent coverage');
});
