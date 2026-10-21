import test from'node:test';import assert from'node:assert/strict';import{readFile,writeFile,mkdtemp,rm}from'node:fs/promises';import{tmpdir}from'node:os';import{join,resolve}from'node:path';import{createHash}from'node:crypto';import * as T from'three';
import{repairSnowRabbitArmRig}from'./lib/pet-snow-rabbit-anatomical-arms.mjs';import{parseStudioGlb}from'./lib/pet-studio-glb.mjs';import{loadPetDeformationProbe}from'./lib/pet-deformation-probe.mjs';
const fixture=n=>new URL('./fixtures/pet-snow-rabbit-anatomical-arms/'+n,import.meta.url),sha=b=>createHash('sha256').update(b).digest('hex');
test('Snow Rabbit arm repair reproduces the frozen private candidate and preserves its sculpt and thirteen authored performances',async()=>{
 const input=await readFile(fixture('source.glb')),original=await readFile(fixture('original.glb')),result=await repairSnowRabbitArmRig(input,original),a=parseStudioGlb(input),b=parseStudioGlb(result.bytes);
 assert.equal(sha(result.bytes),'451b7679cf31e7e3420bba8a0481b1c9aa7481069ab77ab1158ffc7ff234ad59');
 assert.ok(b.bin.subarray(0,a.bin.length).equals(a.bin),'Original geometry, images and animation binary streams changed');
 for(const key of['animations','materials','textures','images','samplers'])assert.deepEqual(b.json[key],a.json[key]);assert.equal(b.json.animations.length,13);
 for(const key of['POSITION','NORMAL','TEXCOORD_0'])assert.equal(b.json.meshes[0].primitives[0].attributes[key],a.json.meshes[0].primitives[0].attributes[key]);assert.equal(b.json.meshes[0].primitives[0].indices,a.json.meshes[0].primitives[0].indices);
 const changed=[];for(let i=0;i<a.json.nodes.length;i++)if(JSON.stringify(a.json.nodes[i])!==JSON.stringify(b.json.nodes[i])){const before=structuredClone(a.json.nodes[i]);assert.match(before.name,/^(upper_arm|forearm|hand)\.[LR]$/);changed.push(before.name);before.translation=b.json.nodes[i].translation;assert.deepEqual(before,b.json.nodes[i]);}assert.equal(changed.length,6);
 assert.equal(result.report.measuredSeamPasses,3);assert.equal(result.report.visualApproval,false);
 const directory=await mkdtemp(join(tmpdir(),'rabbit-arm-conservation-'));const models=[];
 try{const output=join(directory,'candidate.glb');await writeFile(output,result.bytes);const before=await loadPetDeformationProbe(fixture('source.glb')),after=await loadPetDeformationProbe(output);models.push(before,after);let maximumBindDrift=0;
  const old=before.meshes[0],next=after.meshes[0];for(let v=0;v<old.geometry.attributes.position.count;v++){const p=old.getVertexPosition(v,new T.Vector3()).applyMatrix4(old.matrixWorld),q=next.getVertexPosition(v,new T.Vector3()).applyMatrix4(next.matrixWorld);maximumBindDrift=Math.max(maximumBindDrift,p.distanceTo(q));}assert.ok(maximumBindDrift<.000002,'Rest surface moved rather than correcting its rig');
 }finally{for(const model of models)for(const mesh of model.meshes)mesh.geometry.dispose();assert.ok(resolve(directory).startsWith(resolve(tmpdir())+'/')||resolve(directory).startsWith(resolve(tmpdir())+'\\'));await rm(directory,{recursive:true,force:true});}
});
test('Snow Rabbit author rejects a changed source instead of applying the fitted rig to an unreviewed model',async()=>{
 const input=Buffer.from(await readFile(fixture('source.glb')));input[input.length-1]^=1;await assert.rejects(repairSnowRabbitArmRig(input,await readFile(fixture('original.glb'))),/Unexpected Snow Rabbit source/);
});
test('Snow Rabbit author rejects a changed original anatomical ownership reference',async()=>{
 const original=Buffer.from(await readFile(fixture('original.glb')));original[original.length-1]^=1;await assert.rejects(repairSnowRabbitArmRig(await readFile(fixture('source.glb')),original),/Unexpected original anatomical ownership/);
});
