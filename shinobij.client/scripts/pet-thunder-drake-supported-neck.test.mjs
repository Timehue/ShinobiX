import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {Matrix4,Vector3,Quaternion} from 'three';
import {repairThunderDrakeSupportedNeck} from './lib/pet-thunder-drake-supported-neck.mjs';
import {parseStudioGlb} from './lib/pet-studio-glb.mjs';
import {MeshoptDecoder} from 'meshoptimizer';
import {createCharacterRig,readCharacterTake,sampleChannel} from './lib/pet-character-motion.mjs';
const input=await readFile(new URL('./fixtures/pet-thunder-drake-supported-neck/legendary-11.glb',import.meta.url));
const result=await repairThunderDrakeSupportedNeck(input),before=parseStudioGlb(input),after=parseStudioGlb(result.bytes);
// Compare every mesh stream, including UVs and unsigned 32-bit indices.
async function readStudioAccessor(json,bin,index){
 await MeshoptDecoder.ready;
 const a=json.accessors[index],v=json.bufferViews[a.bufferView],ext=v.extensions?.EXT_meshopt_compression;
 const width={SCALAR:1,VEC2:2,VEC3:3,VEC4:4,MAT4:16}[a.type];
 const [size,read,divisor]={5120:[1,'getInt8',127],5121:[1,'getUint8',255],5122:[2,'getInt16',32767],5123:[2,'getUint16',65535],5125:[4,'getUint32',4294967295],5126:[4,'getFloat32',1]}[a.componentType];
 let bytes=bin.subarray(v.byteOffset??0,(v.byteOffset??0)+v.byteLength),stride=v.byteStride??width*size;
 if(ext){bytes=new Uint8Array(ext.count*ext.byteStride);stride=ext.byteStride;MeshoptDecoder.decodeGltfBuffer(bytes,ext.count,ext.byteStride,bin.subarray(ext.byteOffset??0,(ext.byteOffset??0)+ext.byteLength),ext.mode,ext.filter);}
 const data=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
 return Array.from({length:a.count*width},(_,i)=>{const x=data[read]((a.byteOffset??0)+Math.floor(i/width)*stride+i%width*size,true);return a.normalized?Math.max(-1,x/divisor):x;});
}

test('Thunder Drake neck repair preserves geometry, bind transforms, materials and all unrelated animation tracks',async()=>{
 assert.deepEqual(after.json.nodes,before.json.nodes);
 assert.deepEqual(after.json.materials,before.json.materials);
 for(let i=0;i<before.json.skins.length;i++){
  const a=before.json.skins[i],b=after.json.skins[i];assert.deepEqual(b.joints,a.joints);
  assert.deepEqual(await readStudioAccessor(after.json,after.bin,b.inverseBindMatrices),await readStudioAccessor(before.json,before.bin,a.inverseBindMatrices));
 }
 assert.deepEqual(after.json.textures,before.json.textures);
 for(let i=0;i<before.json.images.length;i++){
  const a=before.json.bufferViews[before.json.images[i].bufferView],b=after.json.bufferViews[after.json.images[i].bufferView];
  assert.deepEqual(after.bin.subarray(b.byteOffset??0,(b.byteOffset??0)+b.byteLength),before.bin.subarray(a.byteOffset??0,(a.byteOffset??0)+a.byteLength));
 }
 for(let m=0;m<before.json.meshes.length;m++)for(let p=0;p<before.json.meshes[m].primitives.length;p++){
  const a=before.json.meshes[m].primitives[p],b=after.json.meshes[m].primitives[p];
  assert.deepEqual(Object.keys(b.attributes),Object.keys(a.attributes));
  for(const key of Object.keys(a.attributes))assert.deepEqual(await readStudioAccessor(after.json,after.bin,b.attributes[key]),await readStudioAccessor(before.json,before.bin,a.attributes[key]),key);
  assert.deepEqual(await readStudioAccessor(after.json,after.bin,b.indices),await readStudioAccessor(before.json,before.bin,a.indices));
 }
 const allowed=new Set(['head:rotation','neck:rotation']);
 let changed=0;
 assert.equal(after.json.animations.length,before.json.animations.length);
 for(const oldClip of before.json.animations){
  const newClip=after.json.animations.find(c=>c.name===oldClip.name);assert.ok(newClip);
  const a=await readCharacterTake(before.json,before.bin,oldClip),b=await readCharacterTake(after.json,after.bin,newClip);
  assert.equal(b.duration,a.duration);
  const originalKeys=new Set(a.channels.map(c=>`${c.node}:${c.path}`));
  for(const c of b.channels){
   const prior=a.channels.find(x=>x.node===c.node&&x.path===c.path),key=`${before.json.nodes[c.node].name}:${c.path}`;
   if(['idle','idle_2','attack','idle_hitreact1','death','cast','guard','rest','victory'].includes(oldClip.name)&&allowed.has(key)){changed++;continue;}
   assert.ok(prior,`${oldClip.name}/${key} unexpected channel`);
   assert.deepEqual(c,prior,`${oldClip.name}/${key}`);originalKeys.delete(`${c.node}:${c.path}`);
  }
  for(const c of a.channels)if(['idle','idle_2','attack','idle_hitreact1','death','cast','guard','rest','victory'].includes(oldClip.name)&&allowed.has(`${before.json.nodes[c.node].name}:${c.path}`))originalKeys.delete(`${c.node}:${c.path}`);
  assert.equal(originalKeys.size,0,`${oldClip.name} removed channel`);
 }
 assert.equal(changed,18);assert.equal(result.report.clips.length,9);assert.ok(result.report.clips.every(c=>c.tracks===2));
});

test('head and neck retain expressive motion while reducing their excursion',async()=>{
 for(const clip of result.report.clips){
  const a=await readCharacterTake(before.json,before.bin,before.json.animations.find(c=>c.name===clip.name));
  const b=await readCharacterTake(after.json,after.bin,after.json.animations.find(c=>c.name===clip.name));
  const rig=createCharacterRig(after.json);
  for(const [bone,factor] of [['head',.35],['neck',.5]]){
   const node=rig.byName.get(bone),old=a.channels.find(c=>c.node===node&&c.path==='rotation'),next=b.channels.find(c=>c.node===node&&c.path==='rotation');
   let oldMax=0,newMax=0;
   for(let i=0;i<=480;i++){
    const rest=rig.bind[node].q;
    oldMax=Math.max(oldMax,rest.angleTo(new Quaternion().fromArray(sampleChannel(old,i/480))));
    newMax=Math.max(newMax,rest.angleTo(new Quaternion().fromArray(sampleChannel(next,i/480))));
   }
   assert.ok(oldMax>.001,clip.name+'/'+bone+' original motion');
   assert.ok(newMax>oldMax*factor*.95&&newMax<oldMax*factor*1.05,clip.name+'/'+bone+' reduced, non-frozen excursion '+newMax+'/'+oldMax);
  }
 }
});
test('neck repair rejects another source and reproduces the reviewed intermediate',async()=>{
 await assert.rejects(()=>repairThunderDrakeSupportedNeck(Buffer.from('wrong asset')),/Unexpected Thunder Drake neck source/);
 assert.deepEqual((await repairThunderDrakeSupportedNeck(input)).bytes,result.bytes);
 assert.deepEqual(await readFile(new URL('./fixtures/pet-thunder-drake-coordinated-actions/legendary-11.glb',import.meta.url)),result.bytes);
});
