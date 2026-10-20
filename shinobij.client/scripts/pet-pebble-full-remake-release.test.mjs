import test from 'node:test';
import assert from 'node:assert/strict';
import{readFile}from'node:fs/promises';
import{fileURLToPath}from'node:url';
import{parseStudioGlb}from'./lib/pet-studio-glb.mjs';
import{loadPetDeformationProbe}from'./lib/pet-deformation-probe.mjs';
import{finalizePebbleFullRemake}from'./lib/pet-pebble-full-remake-release.mjs';
import{assertReviewedFullRemakePebblePayload,assertReviewedDistinctPebblePayload}from'./lib/pet-reviewed-payload.mjs';
for(const stage of ['source','battle'])test(`Pebble ${stage}: release bytes differ from the twice-inspected candidate only in root provenance`,async()=>{
 const candidate=new URL(`../../docs/asset-sources/pebble-tortoise-remake-2026-10-19/candidate-${stage==='source'?'full':'battle'}-v9-reviewed-unreleased.glb`,import.meta.url);
 const canonical=new URL(`../public/pet-models/${stage==='battle'?'warfront-lod/':''}starter-earth.glb`,import.meta.url);
 const before=await readFile(candidate),after=await readFile(canonical),result=finalizePebbleFullRemake(before,stage);
 assert.deepEqual(result.bytes,after);assert.equal(result.proof.binaryIdentical,true);assert.equal(result.proof.jsonExceptRootExtrasIdentical,true);
 const json=parseStudioGlb(after).json,path=fileURLToPath(canonical);
 assert.doesNotThrow(()=>assertReviewedFullRemakePebblePayload(path,after,json));
 const changed=Buffer.from(after);changed[changed.length-1]^=1;
 assert.throws(()=>assertReviewedFullRemakePebblePayload(path,changed,json),/payload is stale/);
 assert.throws(()=>finalizePebbleFullRemake(changed,stage),/Uninspected Pebble/);
 const borrowed=structuredClone(json);borrowed.extras.pebbleFullRemake.geometryEntirelyNew=false;
 assert.throws(()=>assertReviewedFullRemakePebblePayload(path,after,borrowed));
 assert.throws(()=>assertReviewedFullRemakePebblePayload(fileURLToPath(new URL('../public/pet-models/roster/standard-5.glb',import.meta.url)),after,json),/only approved for Pebble/);
});
test('rejected detached scalp never satisfies the replacement provenance gate',async()=>{
 const path=new URL('./fixtures/pet-pebble-full-remake-private/rejected-public-scalp.glb',import.meta.url),bytes=await readFile(path),json=parseStudioGlb(bytes).json;
 assert.throws(()=>assertReviewedDistinctPebblePayload(fileURLToPath(path),bytes,json),/rejected Pebble scalp/);
 assert.throws(()=>assertReviewedFullRemakePebblePayload(fileURLToPath(new URL('../public/pet-models/starter-earth.glb',import.meta.url)),bytes,json));
});
test('new sculpt retains the complete thirteen-take rig and every non-root animation curve',async()=>{
 const before=await loadPetDeformationProbe(new URL('./fixtures/pet-pebble-full-remake-private/rejected-public-scalp.glb',import.meta.url));
 for(const stage of ['source','battle']){const after=await loadPetDeformationProbe(new URL(`../public/pet-models/${stage==='battle'?'warfront-lod/':''}starter-earth.glb`,import.meta.url));
 assert.deepEqual(after.meshes[0].skeleton.bones.map(b=>b.name),before.meshes[0].skeleton.bones.map(b=>b.name));
 assert.equal(after.animations.length,13);for(let i=0;i<13;i++){const a=before.animations[i],b=after.animations[i];assert.equal(b.name,a.name);assert.equal(b.duration,a.duration);assert.deepEqual(b.tracks.map(t=>t.name),a.tracks.map(t=>t.name));
 for(let k=0;k<a.tracks.length;k++){if(a.tracks[k].name==='root.position')continue;assert.deepEqual(b.tracks[k].times,a.tracks[k].times);assert.deepEqual(b.tracks[k].values,a.tracks[k].values);}}
 }
});
