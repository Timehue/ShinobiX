import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import * as THREE from 'three';
import {repairDuneViperLegRig} from './lib/pet-dune-viper-four-leg-rig.mjs';
import {parseStudioGlb} from './lib/pet-studio-glb.mjs';
import {loadPetDeformationProbeBytes} from './lib/pet-deformation-probe.mjs';

const original=await readFile(new URL('./fixtures/pet-dune-viper-four-legs-20261021/original.glb',import.meta.url));
const repaired=await repairDuneViperLegRig(original);
test('four-leg rig preserves the snake sculpture, texture and every authored performance',async()=>{
    const before=parseStudioGlb(original),after=parseStudioGlb(repaired.bytes);
    assert.equal(repaired.report.outputSha256,'08f51ca825d1ce6fb9b7dd92ba0a91f8cf2b7115b7e71622d3914fd73aede6d8');
    assert.ok(after.bin.subarray(0,before.bin.length).equals(before.bin));
    for(const key of ['animations','materials','textures','images','samplers'])assert.deepEqual(after.json[key],before.json[key],key);
    const a=before.json.meshes[0].primitives[0],b=after.json.meshes[0].primitives[0];
    assert.equal(a.indices,b.indices);
    for(const key of Object.keys(a.attributes))if(!['JOINTS_0','WEIGHTS_0'].includes(key))assert.equal(a.attributes[key],b.attributes[key],key);
    const moved=[];
    before.json.nodes.forEach((node,i)=>{const next=after.json.nodes[i];if(JSON.stringify(node)!==JSON.stringify(next)){moved.push(node.name);const copy={...next,translation:node.translation};assert.deepEqual(copy,node);}});
    assert.deepEqual(moved.sort(),['upper_arm.L','forearm.L','hand.L','upper_arm.R','forearm.R','hand.R','thigh.L','shin.L','foot.L','thigh.R','shin.R','foot.R'].sort());
    assert.ok(repaired.report.maximumBindDrift<.000005);
    await assert.rejects(repairDuneViperLegRig(Buffer.from('unreviewed input')),/Unexpected Dune Viper/);
});

test('the foot behind the front leg no longer shares the rear-leg controls',async()=>{
    const old=(await loadPetDeformationProbeBytes(original)).meshes[0],next=(await loadPetDeformationProbeBytes(repaired.bytes)).meshes[0];
    const share=(mesh,v,names)=>[0,1,2,3].reduce((sum,k)=>sum+(names.includes(mesh.skeleton.bones[mesh.geometry.attributes.skinIndex.getComponent(v,k)].name)?mesh.geometry.attributes.skinWeight.getComponent(v,k):0),0);
    const hind=['thighL','shinL','footL','thighR','shinR','footR'];
    // Frozen triangle from the user's visible protrusion, picked in the original animation.
    assert.ok(share(old,7135,hind)>.95,'Negative control must reproduce rear-chain ownership of the front foot');
    assert.ok(share(next,7135,['upper_armR','forearmR','handR'])>.99);
    assert.equal(share(next,7135,hind),0);
    const feet=[{p:[.18,-.455,.35],names:['upper_armL','forearmL','handL']},{p:[-.20,-.455,.35],names:['upper_armR','forearmR','handR']},{p:[.255,-.455,-.135],names:['thighL','shinL','footL']},{p:[-.275,-.455,-.315],names:['thighR','shinR','footR']}];
    for(const foot of feet){const target=new THREE.Vector3(...foot.p);let nearest=-1,distance=Infinity;for(let v=0;v<old.geometry.attributes.position.count;v++){const p=old.getVertexPosition(v,new THREE.Vector3()).applyMatrix4(old.matrixWorld),d=p.distanceToSquared(target);if(d<distance){distance=d;nearest=v;}}assert.ok(share(next,nearest,foot.names)>.99,`Foot ${foot.p} must follow its own limb`);}
});
