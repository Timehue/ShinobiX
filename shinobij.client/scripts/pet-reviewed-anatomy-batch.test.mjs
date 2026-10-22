import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import * as THREE from 'three';
import {loadPetDeformationProbe,snapshotPetPose,petClipSampleTimes} from './lib/pet-deformation-probe.mjs';
import {repairReviewedPetSkull} from './repair-reviewed-pet-skull.mjs';
import {assertReviewedAnimationConservation} from './lib/pet-animation-conservation.mjs';
import {createIndependentFaceProbe} from '../src/pet-independent-face-probe.ts';
const annotations=JSON.parse(await readFile(new URL('./pet-independent-face-landmarks.json',import.meta.url))).pets,repairs=JSON.parse(await readFile(new URL('./pet-complete-face-repairs.json',import.meta.url))).pets,fixture=id=>new URL('./fixtures/pet-complete-face-20261015/'+id+'-v1.glb',import.meta.url);
function sweep(m,a){const p=createIndependentFaceProbe(m.meshes,a),restore=snapshotPetPose(m.scene),mix=new THREE.AnimationMixer(m.scene);for(const c of m.animations)for(const time of petClipSampleTimes(c,24)){mix.stopAllAction();restore();const x=mix.clipAction(c).reset().setLoop(THREE.LoopOnce,1);x.clampWhenFinished=true;x.play();x.time=time;mix.update(0);m.update();p.measure(time);}for(const from of m.animations)for(const to of m.animations)if(from!==to)for(const blend of [.25,.5,.75]){mix.stopAllAction();restore();for(const[c,w,phase]of[[from,1-blend,.75],[to,blend,.25]]){const x=mix.clipAction(c).reset().setLoop(THREE.LoopOnce,1);x.clampWhenFinished=true;x.setEffectiveWeight(w).play();x.time=c.duration*phase;}mix.update(0);m.update();p.measure(blend);}return p.report();}
for(const id of ['legendary-27','legendary-28','legendary-29','mythic-2']){test(id+': original independently marked complete face detects released distortion',async()=>{const m=await loadPetDeformationProbe(fixture(id));assert.equal(m.sha256,annotations[id].sourceSha256);assert.equal(sweep(m,annotations[id]).failed,true);});for(const stage of ['roster','warfront-lod/roster'])test(id+' '+stage+': complete face passes every clip and cross-clip blend',async()=>{const m=await loadPetDeformationProbe(new URL('../public/pet-models/'+stage+'/'+id+'.glb',import.meta.url));assert.equal(sweep(m,annotations[id]).failed,false);});test(id+': exact repair replay retains sculpt, textures, rig and every authored curve',async()=>{const dir=await mkdtemp(join(tmpdir(),'pet-reviewed-batch-'));try{const p=join(dir,'candidate.glb');await repairReviewedPetSkull(id,fileURLToPath(fixture(id)),p,repairs[id]);const m=await loadPetDeformationProbe(p),a=await loadPetDeformationProbe(fixture(id)),ship=await readFile(new URL('../public/pet-models/roster/'+id+'.glb',import.meta.url));assert.deepEqual(await readFile(p),ship);for(const n of ['position','normal','uv'])assert.deepEqual(m.meshes[0].geometry.attributes[n].array,a.meshes[0].geometry.attributes[n].array);assert.deepEqual(m.meshes[0].geometry.index.array,a.meshes[0].geometry.index.array);assert.deepEqual(m.json.nodes,a.json.nodes);assert.deepEqual(m.json.materials,a.json.materials);assert.deepEqual(m.json.textures,a.json.textures);for(const[i,img]of a.json.images.entries()){const x=a.json.bufferViews[img.bufferView],y=m.json.bufferViews[m.json.images[i].bufferView];assert.deepEqual(a.binary.subarray(x.byteOffset,x.byteOffset+x.byteLength),m.binary.subarray(y.byteOffset,y.byteOffset+y.byteLength));}assertReviewedAnimationConservation(a,m);}finally{await rm(dir,{recursive:true,force:true});}});}

test('legendary-29: independent shoulder band rejects the broad candidate and preserves original body bindings',async()=>{
    const original=await loadPetDeformationProbe(fixture('legendary-29'));
    const rejected=await loadPetDeformationProbe(new URL('./fixtures/pet-treant-shoulder/legendary-29-rejected-v1.glb',import.meta.url));
    const current=await loadPetDeformationProbe(new URL('../public/pet-models/roster/legendary-29.glb',import.meta.url));
    assert.equal(rejected.sha256,'08fddbbe45b95b11fac1d83eed9d1c81f48210db1ecc44b3660103cdc1cc6697');
    const frame=new THREE.Matrix4().fromArray(annotations['legendary-29'].geometryToVisibleBind),p=new THREE.Vector3();
    const a=original.meshes[0],b=current.meshes[0],c=rejected.meshes[0];
    const palette=(mesh,v)=>{const values=Array(a.skeleton.bones.length).fill(0),g=mesh.geometry;for(let s=0;s<4;s++)values[g.attributes.skinIndex.getComponent(v,s)]+=g.attributes.skinWeight.getComponent(v,s);return values;};
    let protectedCount=0,rejectedChanged=0;
    // Frozen visible-bind shoulder/upper-arm band, independent of repair envelopes.
    for(let v=0;v<a.geometry.attributes.position.count;v++){
        p.fromBufferAttribute(a.geometry.attributes.position,v).applyMatrix4(frame);
        if(Math.abs(p.x)<=.22||p.y<.10||p.y>=.48||p.z<-.20||p.z>.40)continue;
        const baseline=palette(a,v);assert.deepEqual(palette(b,v),baseline,'Shoulder binding changed at '+v);
        if(JSON.stringify(palette(c,v))!==JSON.stringify(baseline))rejectedChanged++;
        protectedCount++;
    }
    assert.ok(protectedCount>500);assert.ok(rejectedChanged>100,'Broad candidate must fail the independent shoulder control');
    assert.deepEqual(current.json.nodes,original.json.nodes);
    assertReviewedAnimationConservation(original,current);
});

test('mythic-2: original shoulder, arm and lower-body palettes remain unchanged by the beard repair',async()=>{const before=await loadPetDeformationProbe(fixture('mythic-2')),after=await loadPetDeformationProbe(new URL('../public/pet-models/roster/mythic-2.glb',import.meta.url)),a=before.meshes[0].geometry.attributes,b=after.meshes[0].geometry.attributes,frame=new THREE.Matrix4().fromArray(annotations['mythic-2'].geometryToVisibleBind),point=new THREE.Vector3();let protectedCount=0;for(let v=0;v<a.position.count;v++){point.fromBufferAttribute(a.position,v).applyMatrix4(frame);if(Math.abs(point.x)>=.36||point.y<=.08){for(let k=0;k<4;k++){assert.equal(b.skinIndex.getComponent(v,k),a.skinIndex.getComponent(v,k));assert.equal(b.skinWeight.getComponent(v,k),a.skinWeight.getComponent(v,k));}protectedCount++;}}assert.ok(protectedCount>10000,'Original shoulders, arms and lower body need independent coverage');});
