import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import * as THREE from 'three';
import {repairForestNeckCloth} from './lib/pet-forest-hawk-neck-cloth.mjs';
import {parseStudioGlb} from './lib/pet-studio-glb.mjs';
import {loadPetDeformationProbeBytes} from './lib/pet-deformation-probe.mjs';

test('Forest Hawk collar repair retains the sculpt, colors and all thirteen performances',async()=>{
    const original=await readFile(new URL('./fixtures/pet-forest-hawk-neck-cloth-20261021/original.glb',import.meta.url)),result=await repairForestNeckCloth(original),a=parseStudioGlb(original),b=parseStudioGlb(result.bytes);
    assert.equal(result.report.outputSha256,'56167f114c6650325944de89162f2f899466a77bdefdf118c84588a7f57788b6');
    assert.ok(b.bin.subarray(0,a.bin.length).equals(a.bin));
    for(const key of ['animations','materials','textures','images','samplers'])assert.deepEqual(b.json[key],a.json[key],key);
    assert.equal(a.json.animations.length,13);
    const old=a.json.meshes[0].primitives[0],next=b.json.meshes[0].primitives[0];assert.equal(next.indices,old.indices);
    for(const key of Object.keys(old.attributes))if(!['JOINTS_0','WEIGHTS_0'].includes(key))assert.equal(next.attributes[key],old.attributes[key]);
    const moved=[];a.json.nodes.forEach((node,i)=>{const changed=b.json.nodes[i];if(JSON.stringify(node)!==JSON.stringify(changed)){moved.push(node.name);assert.deepEqual({...changed,translation:node.translation},node);}});assert.deepEqual(moved.sort(),['head','neck']);
    const before=await loadPetDeformationProbeBytes(original),after=await loadPetDeformationProbeBytes(result.bytes);let maximumBindDrift=0;
    for(let v=0;v<before.meshes[0].geometry.attributes.position.count;v++){const p=before.meshes[0].getVertexPosition(v,new THREE.Vector3()).applyMatrix4(before.meshes[0].matrixWorld),q=after.meshes[0].getVertexPosition(v,new THREE.Vector3()).applyMatrix4(after.meshes[0].matrixWorld);maximumBindDrift=Math.max(maximumBindDrift,p.distanceTo(q));}
    assert.ok(maximumBindDrift<.000002,'The original default-bind sculpture must remain unchanged at skin precision');
    console.log({maximumBindDrift});
    await assert.rejects(repairForestNeckCloth(Buffer.from('unreviewed source')),/Unexpected|Assertion/);
});
