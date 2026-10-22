import test from 'node:test';import assert from 'node:assert/strict';
import {readFile,mkdtemp,writeFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import * as T from 'three';
import {repairFrostWyrmTailClearance} from './lib/pet-frost-wyrm-tail-clearance.mjs';
import {loadPetDeformationProbe,snapshotPetPose} from './lib/pet-deformation-probe.mjs';
const fixture=new URL('./fixtures/pet-frost-wyrm-tail-clearance/legendary-19.glb',import.meta.url),marks=JSON.parse(await readFile(new URL('./fixtures/pet-frost-wyrm-tail-clearance/visible-tail-landmarks.json',import.meta.url)));
async function withModels(fn){const bytes=await readFile(fixture),result=await repairFrostWyrmTailClearance(bytes),dir=await mkdtemp(join(tmpdir(),'frost-wyrm-tail-'));try{const path=join(dir,'candidate.glb');await writeFile(path,result.bytes);await fn(await loadPetDeformationProbe(fixture),await loadPetDeformationProbe(path),result);}finally{await rm(dir,{recursive:true,force:true});}}
test('Frost Wyrm tail clearance preserves sculpt, textures, rig and every unrelated animation track',()=>withModels(async(before,after,result)=>{
    assert.deepEqual(after.json.nodes,before.json.nodes);assert.deepEqual(after.json.materials,before.json.materials);assert.deepEqual(after.json.textures,before.json.textures);
    for(const name of ['position','normal','uv','skinIndex','skinWeight'])assert.deepEqual(after.meshes[0].geometry.attributes[name].array,before.meshes[0].geometry.attributes[name].array);
    assert.deepEqual(after.meshes[0].geometry.index.array,before.meshes[0].geometry.index.array);
    for(const [i,img]of before.json.images.entries()){const a=before.json.bufferViews[img.bufferView],b=after.json.bufferViews[after.json.images[i].bufferView];assert.deepEqual(before.binary.subarray(a.byteOffset,a.byteOffset+a.byteLength),after.binary.subarray(b.byteOffset,b.byteOffset+b.byteLength));}
    const edited=new Set(result.report.clips.map(c=>c.name));let added=0;
    for(const clip of before.animations){const next=after.animations.find(c=>c.name===clip.name);for(const t of clip.tracks){const n=next.tracks.find(x=>x.name===t.name);assert.ok(n);if(edited.has(clip.name)&&t.name==='tail_1.quaternion')continue;assert.deepEqual(n.times,t.times);assert.deepEqual(n.values,t.values);}for(const t of next.tracks)if(!clip.tracks.some(x=>x.name===t.name)){assert.equal(t.name,'tail_1.quaternion');assert.ok(edited.has(clip.name));added++;}}
    assert.equal(added,9);const deathBefore=before.animations.find(c=>c.name==='death'),deathAfter=after.animations.find(c=>c.name==='death');assert.equal(deathAfter.duration,deathBefore.duration);assert.equal(deathAfter.tracks.length,deathBefore.tracks.length);
}));
test('Frost Wyrm independently frozen visible tail stays above the standing floor between animation keys',()=>withModels(async(before,after)=>{
    assert.equal(before.sha256,marks.sourceSha256);assert.equal(marks.indices.length,1866);let originalWorst=0,candidateWorst=Infinity;
    for(const model of [before,after]){const restore=snapshotPetPose(model.scene),mixer=new T.AnimationMixer(model.scene),s=model.meshes[0];for(const name of marks.reviewedStandingClips){const c=model.animations.find(c=>c.name===name);let min=Infinity;for(let i=0;i<=480;i++){mixer.stopAllAction();restore();const a=mixer.clipAction(c).reset().setLoop(T.LoopOnce,1);a.clampWhenFinished=true;a.play();a.time=i/480*c.duration;mixer.update(0);model.update();for(const v of marks.indices)min=Math.min(min,s.getVertexPosition(v,new T.Vector3()).applyMatrix4(s.matrixWorld).y-marks.floor);}if(model===before)originalWorst=Math.min(originalWorst,min);else{candidateWorst=Math.min(candidateWorst,min);assert.ok(min>.002,`${name}: tail below support clearance ${min}`);}}}
    assert.ok(originalWorst<-.038);assert.ok(candidateWorst>.002);
}));
test('Frost Wyrm tail recipe is deterministic and rejects an altered face source',async()=>{const bytes=await readFile(fixture),a=await repairFrostWyrmTailClearance(bytes),b=await repairFrostWyrmTailClearance(bytes);assert.deepEqual(a.bytes,b.bytes);const changed=Buffer.from(bytes);changed[changed.length-5]^=1;await assert.rejects(repairFrostWyrmTailClearance(changed),/Unexpected Frost Wyrm/);});
