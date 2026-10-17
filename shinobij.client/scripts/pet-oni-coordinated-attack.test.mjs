import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {Matrix4,Vector3} from 'three';
import {repairOniCoordinatedAttack} from './lib/pet-oni-coordinated-attack.mjs';
import {parseStudioGlb} from './lib/pet-studio-glb.mjs';
import {MeshoptDecoder} from 'meshoptimizer';
import {createCharacterRig,readCharacterTake,sampleChannel} from './lib/pet-character-motion.mjs';
const input=await readFile(new URL('./fixtures/pet-oni-coordinated-attack/mythic-4.glb',import.meta.url));
const result=await repairOniCoordinatedAttack(input),before=parseStudioGlb(input),after=parseStudioGlb(result.bytes);
test('delivered Oni source is exactly reproducible from the pinned face repair and action recipe',async()=>{
 assert.deepEqual(await readFile(new URL('../public/pet-models/roster/mythic-4.glb',import.meta.url)),result.bytes);
});
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

test('Oni attack repair preserves geometry, bind transforms, materials and all unrelated animation tracks',async()=>{
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
 const allowed=new Set(['root:translation','spine:rotation',...['L','R'].flatMap(side=>['front','hind'].flatMap(part=>['upper','lower','paw'].map(joint=>`${part}_${joint}.${side}:rotation`)))]);
 let changed=0;
 assert.equal(after.json.animations.length,before.json.animations.length);
 for(const oldClip of before.json.animations){
  const newClip=after.json.animations.find(c=>c.name===oldClip.name);assert.ok(newClip);
  const a=await readCharacterTake(before.json,before.bin,oldClip),b=await readCharacterTake(after.json,after.bin,newClip);
  assert.equal(b.duration,a.duration);
  const originalKeys=new Set(a.channels.map(c=>`${c.node}:${c.path}`));
  for(const c of b.channels){
   const prior=a.channels.find(x=>x.node===c.node&&x.path===c.path),key=`${before.json.nodes[c.node].name}:${c.path}`;
   if(['attack','cast','idle_hitreact1'].includes(oldClip.name)&&allowed.has(key)){changed++;continue;}
   assert.ok(prior,`${oldClip.name}/${key} unexpected channel`);
   assert.deepEqual(c,prior,`${oldClip.name}/${key}`);originalKeys.delete(`${c.node}:${c.path}`);
  }
  for(const c of a.channels)if(['attack','cast','idle_hitreact1'].includes(oldClip.name)&&allowed.has(`${before.json.nodes[c.node].name}:${c.path}`))originalKeys.delete(`${c.node}:${c.path}`);
  assert.equal(originalKeys.size,0,`${oldClip.name} removed channel`);
 }
 assert.equal(changed,42);assert.ok(result.report.clips.every(c=>c.changedTracks===14));
});

test('decoded production splines keep three support paws planted between authoring keys',async()=>{
 for(const name of ['attack','cast','idle_hitreact1']){
 const rig=createCharacterRig(after.json),take=await readCharacterTake(after.json,after.bin,after.json.animations.find(c=>c.name===name));
 let max=0,swipeHeight=0;
 for(let i=0;i<=480;i++){
  rig.reset();
  for(const c of take.channels){const n=rig.nodes[c.node],v=sampleChannel(c,i/480);if(c.path==='rotation')n.quaternion.fromArray(v);else if(c.path==='translation')n.position.fromArray(v);else n.scale.fromArray(v);}
  rig.scene.updateMatrixWorld(true);
  for(const chain of rig.chains){
   const foot=rig.nodes[chain.ids[2]].getWorldPosition(new Vector3()).applyMatrix4(new Matrix4().copy(chain.frame.matrixWorld).invert());
   if(name==='attack'&&chain.part==='front'&&chain.side==='L'){swipeHeight=Math.max(swipeHeight,foot.clone().sub(chain.origin).dot(chain.up));continue;}
   max=Math.max(max,foot.distanceTo(chain.origin));
  }
 }
 assert.ok(max<.0003,`${name} support paw slip: ${max}`);if(name==='attack')assert.ok(swipeHeight>.05&&swipeHeight<.06,`Swipe clearance: ${swipeHeight}`);
 }
 assert.equal(after.json.extras.characterMotion.plantedAttack,true);
 assert.equal(after.json.extras.characterMotion.plantedRecoil,true);
});

test('Oni author rejects an unexpected source instead of applying the recipe to another model',async()=>{
 await assert.rejects(()=>repairOniCoordinatedAttack(Buffer.from('wrong asset')),/Unexpected Oni source/);
});
