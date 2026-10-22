import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import * as THREE from 'three';
import {repairSkyFalconTabs} from './lib/pet-sky-falcon-tabs.mjs';
import {loadPetDeformationProbeBytes,snapshotPetPose} from './lib/pet-deformation-probe.mjs';
import {parseStudioGlb,readStudioAccessor} from './lib/pet-studio-glb.mjs';
const original=await readFile(new URL('./fixtures/pet-sky-falcon-tabs-20261021/original.glb',import.meta.url));
const selection=JSON.parse(await readFile(new URL('./fixtures/pet-sky-falcon-tabs-20261021/frozen-selection.json',import.meta.url))).vertexUnion.sourceVertexIds;
const repaired=await repairSkyFalconTabs(original);
test('Sky Falcon tab repair changes only the diagnosed skin palettes and preserves all actual wing bindings',async()=>{
    const a=parseStudioGlb(original),b=parseStudioGlb(repaired.bytes),selected=new Set(repaired.report.selectedVertexIds);
    assert.equal(repaired.report.changedVertices,303);
    assert.equal(repaired.report.sha256,'bb79c492e29c5dcf4ec9c3ff97fe04ab6da60a55f4727d07a0139d20d28f75c8');
    assert.ok(b.bin.subarray(0,a.bin.length).equals(a.bin));
    for(const key of ['nodes','skins','animations','materials','textures','images','samplers'])assert.deepEqual(b.json[key],a.json[key],key);
    const old=a.json.meshes[0].primitives[0],next=b.json.meshes[0].primitives[0];assert.equal(next.indices,old.indices);
    for(const key of Object.keys(old.attributes))if(!['JOINTS_0','WEIGHTS_0'].includes(key))assert.equal(next.attributes[key],old.attributes[key]);
    for(const key of ['JOINTS_0','WEIGHTS_0']){
        const before=(await readStudioAccessor(a.json,a.bin,old.attributes[key])).values,after=(await readStudioAccessor(b.json,b.bin,next.attributes[key])).values;
        assert.equal(after.length,before.length);
        for(let i=0;i<before.length;i++)if(!selected.has(Math.floor(i/4)))assert.equal(after[i],before[i],`${key}: unrelated vertex ${Math.floor(i/4)} changed`);
    }
    await assert.rejects(repairSkyFalconTabs(Buffer.from('unreviewed source')),/Unexpected Sky Falcon/);
});
function sweep(model){
    const selection=repaired.report.selectedVertexIds;
    const mesh=model.meshes[0],head=mesh.skeleton.bones.find(b=>b.name==='head'),point=new THREE.Vector3(),inverse=head.matrixWorld.clone().invert();
    const bind=new Map(selection.map(v=>[v,mesh.getVertexPosition(v,new THREE.Vector3()).applyMatrix4(mesh.matrixWorld).applyMatrix4(inverse)]));
    const mixer=new THREE.AnimationMixer(model.scene),restore=snapshotPetPose(model.scene);let maxDrift=0;
    for(const clip of model.animations)for(let i=0;i<=120;i++){
        mixer.stopAllAction();restore();const action=mixer.clipAction(clip).reset().setLoop(THREE.LoopOnce,1);action.clampWhenFinished=true;action.play();action.time=clip.duration*i/120;mixer.update(0);model.update();inverse.copy(head.matrixWorld).invert();
        for(const v of selection)maxDrift=Math.max(maxDrift,mesh.getVertexPosition(v,point).applyMatrix4(mesh.matrixWorld).applyMatrix4(inverse).distanceTo(bind.get(v)));
    }
    mixer.stopAllAction();return maxDrift;
}
test('both complete head tabs remain rigid through all 13 clips while the frozen source reproduces the wing-driven stretch',async()=>{
    const before=await loadPetDeformationProbeBytes(original),after=await loadPetDeformationProbeBytes(repaired.bytes);
    assert.equal(before.animations.length,13);assert.equal(after.animations.length,13);
    assert.ok(sweep(before)>.1,'Negative control must reproduce visible tab distortion');
    assert.ok(sweep(after)<.00002,'Entire independently selected bilateral tab surface must follow the head');
});
