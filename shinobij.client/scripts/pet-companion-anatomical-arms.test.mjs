import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {repairCompanionArmRig} from './lib/pet-companion-anatomical-arms.mjs';
import {parseStudioGlb} from './lib/pet-studio-glb.mjs';
const expected={
 'standard-2':'109cc8c38508d744ce5bf2dbf181e70d11f6b2a545b799dd4ac23f0f1f51131d',
 'standard-15':'ab43d66d55404a9dcbee9abf6693522d84c987d85f2177002de42ce6f9c8a03a',
 'rare-21':'7f6f76da7133b7c5076e65fd2c5d5dc494493a031650b086a6dafebc488ba10a',
};
for(const [id,pin] of Object.entries(expected))test(`${id}: fitted arms retain the sculpt, materials, thirteen performances and all other bone frames`,async()=>{
 const input=await readFile(new URL(`./fixtures/pet-companion-anatomical-arms-20261021/${id}/original.glb`,import.meta.url));
 const result=await repairCompanionArmRig(input,id),a=parseStudioGlb(input),b=parseStudioGlb(result.bytes);
 assert.equal(result.report.outputSha256,pin);assert.ok(result.report.maximumBindDrift<.000002);
 assert.ok(b.bin.subarray(0,a.bin.length).equals(a.bin),'Original sculpt, texture and performance streams changed');
 for(const key of['animations','materials','textures','images','samplers'])assert.deepEqual(b.json[key],a.json[key]);assert.equal(a.json.animations.length,13);
 const old=a.json.meshes[0].primitives[0],next=b.json.meshes[0].primitives[0];
 for(const key of['POSITION','NORMAL','TEXCOORD_0'])assert.equal(next.attributes[key],old.attributes[key]);assert.equal(next.indices,old.indices);
 let changed=0;for(let i=0;i<a.json.nodes.length;i++)if(JSON.stringify(a.json.nodes[i])!==JSON.stringify(b.json.nodes[i])){
  changed++;assert.match(a.json.nodes[i].name,/^(upper_arm|forearm|hand)\.?[LR]$/);
  assert.deepEqual({...a.json.nodes[i],translation:b.json.nodes[i].translation},b.json.nodes[i]);
 }assert.equal(changed,6);assert.equal(result.report.visualApproval,false);
 const wrong=Buffer.from(input);wrong[wrong.length-1]^=1;await assert.rejects(repairCompanionArmRig(wrong,id),/Unexpected fitted-arm source/);
});
