/** Remove anisotropic skeleton ancestry without changing the visible bind shape.
 * Keep each joint's original bind skin matrix, orthogonalize its rest frame,
 * and retarget the existing local animation deltas into those new rest frames.
 * Always produce an inspection candidate; never overwrite a shipping model.
 */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {loadPetDeformationProbe} from './lib/pet-deformation-probe.mjs';
import {parseStudioGlb,encodeStudioGlb,readStudioAccessor,align4} from './lib/pet-studio-glb.mjs';
import {compactGlbDelivery} from './compact-glb-delivery.mjs';

const rigidMatrix=matrix=>{
 const p=new THREE.Vector3(),q=new THREE.Quaternion(),s=new THREE.Vector3();matrix.decompose(p,q,s);
 return new THREE.Matrix4().compose(p,q.normalize(),new THREE.Vector3(1,1,1));
};
export async function normalizeReviewedPetRigScale(source,destination){
 assert.notEqual(resolve(source),resolve(destination),'Write an inspection candidate');
 const bytes=await readFile(source),{json,bin}=parseStudioGlb(bytes),model=await loadPetDeformationProbe(source);
 assert.ok(!json.extras?.reviewedRigScaleRepair,'Use the original rig');
 assert.equal(model.meshes.length,1);assert.equal(json.skins.length,1);
 const mesh=model.meshes[0],bones=mesh.skeleton.bones,root=bones.find(b=>b.name==='root'),rig=root?.parent;
 assert.ok(rig&&!(rig instanceof THREE.Bone),'Expected a separate rig ancestor');
 assert.ok(Math.max(...rig.scale.toArray())-Math.min(...rig.scale.toArray())>1e-5,'Rig is already uniformly scaled');
 assert.ok(rig.scale.toArray().every(v=>v>0),'Mirrored rig requires a separate repair');
 const oldNodes=structuredClone(json.nodes),nodeIds=new Map(json.nodes.map((n,i)=>[n.name,i])),rigId=nodeIds.get(rig.name);
 const boneNodeIds=new Map(bones.map((bone,i)=>[bone,json.skins[0].joints[i]]));
 assert.equal(new Set(json.nodes.map(n=>n.name)).size,json.nodes.length,'Node names must be unique');
 const worlds=new Map(bones.map(b=>[b,rigidMatrix(b.matrixWorld)])),rigWorld=rigidMatrix(rig.matrixWorld);
 const originalParents=new Map(bones.map(b=>[b,b.parent.matrixWorld.clone()]));
 const originalSkinMatrices=bones.map((b,i)=>b.matrixWorld.clone().multiply(mesh.skeleton.boneInverses[i]));
 const oldRigScale=rig.scale.toArray();rig.scale.set(1,1,1);
 const restChanges=new Map();
 for(const bone of bones){
  const parentWorld=worlds.get(bone.parent)??rigWorld;
  const local=parentWorld.clone().invert().multiply(worlds.get(bone));
  const p=new THREE.Vector3(),q=new THREE.Quaternion(),s=new THREE.Vector3();local.decompose(p,q,s);q.normalize();
  const index=boneNodeIds.get(bone),old=oldNodes[index];assert.ok(!old.matrix,'Matrix nodes need a separate repair');
  restChanges.set(index,{oldPosition:new THREE.Vector3().fromArray(old.translation??[0,0,0]),oldRotation:new THREE.Quaternion().fromArray(old.rotation??[0,0,0,1]),position:p,rotation:q,
   translationMap:parentWorld.clone().invert().multiply(originalParents.get(bone))});
  Object.assign(json.nodes[index],{translation:p.toArray(),rotation:q.toArray(),scale:[1,1,1]});
 }
 json.nodes[rigId].scale=[1,1,1];
 let binary=bin;
 const append=(values,type,count)=>{
  const data=Buffer.from(values.buffer,values.byteOffset,values.byteLength),offset=align4(binary.length);
  binary=Buffer.concat([binary,Buffer.alloc(offset-binary.length),data]);
  const bufferView=json.bufferViews.push({buffer:0,byteOffset:offset,byteLength:data.length})-1;
  return json.accessors.push({bufferView,componentType:5126,type,count})-1;
 };
 const inverseBinds=new Float32Array(bones.length*16);
 bones.forEach((bone,i)=>worlds.get(bone).clone().invert().multiply(originalSkinMatrices[i]).toArray(inverseBinds,i*16));
 json.skins[0].inverseBindMatrices=append(inverseBinds,'MAT4',bones.length);
 let retargetedChannels=0;
 for(const animation of json.animations)for(const channel of animation.channels){
  const change=restChanges.get(channel.target.node);if(!change)continue;
  const sampler=animation.samplers[channel.sampler];assert.ok(!sampler.interpolation||['LINEAR','STEP','CUBICSPLINE'].includes(sampler.interpolation),'Unsupported interpolation');
  const path=channel.target.path;if(path==='scale')continue;
  assert.ok(path==='rotation'||path==='translation','Unexpected animation channel');
  const accessor=await readStudioAccessor(json,bin,sampler.output),values=new Float32Array(accessor.values.length);
  for(let i=0;i<values.length;i+=accessor.width){
   const tangent=sampler.interpolation==='CUBICSPLINE'&&Math.floor(i/accessor.width)%3!==1;
   if(path==='rotation'){
    const q=new THREE.Quaternion().fromArray(accessor.values,i).premultiply(change.oldRotation.clone().invert()).premultiply(change.rotation);
    if(!tangent)q.normalize();q.toArray(values,i);
   }
   else{
    const delta=new THREE.Vector3().fromArray(accessor.values,i),linear=new THREE.Matrix3().setFromMatrix4(change.translationMap);
    if(!tangent)delta.sub(change.oldPosition);delta.applyMatrix3(linear);if(!tangent)delta.add(change.position);delta.toArray(values,i);
   }
  }
  sampler.output=append(values,path==='rotation'?'VEC4':'VEC3',values.length/accessor.width);retargetedChannels++;
 }
 json.extras.reviewedRigScaleRepair={revision:'20261014-orthogonal-rig-v1',sourceSha256:createHash('sha256').update(bytes).digest('hex'),rigNode:rigId,originalRigScale:oldRigScale,retargetedChannels};
 json.buffers[0].byteLength=align4(binary.length);
 const compacted=parseStudioGlb(compactGlbDelivery(encodeStudioGlb(json,binary)));
 compacted.json.extras.properAnimationSourceBoundary={binLength:compacted.bin.length,accessorCount:compacted.json.accessors.length,bufferViewCount:compacted.json.bufferViews.length};
 await mkdir(dirname(destination),{recursive:true});await writeFile(destination,encodeStudioGlb(compacted.json,compacted.bin));
 const after=await loadPetDeformationProbe(destination);let maxBindError=0;
 assert.equal(after.meshes[0].geometry.attributes.position.count,mesh.geometry.attributes.position.count);
 for(let v=0;v<mesh.geometry.attributes.position.count;v++)maxBindError=Math.max(maxBindError,mesh.getVertexPosition(v,new THREE.Vector3()).applyMatrix4(mesh.matrixWorld).distanceTo(after.meshes[0].getVertexPosition(v,new THREE.Vector3()).applyMatrix4(after.meshes[0].matrixWorld)));
 assert.ok(maxBindError<2e-5,`Bind appearance changed by ${maxBindError}`);
 for(const name of ['position','normal','uv'])if(mesh.geometry.attributes[name])assert.deepEqual(after.meshes[0].geometry.attributes[name].array,mesh.geometry.attributes[name].array);
 assert.deepEqual(after.meshes[0].geometry.index.array,mesh.geometry.index.array);
 for(const bone of after.meshes[0].skeleton.bones){const scale=bone.getWorldScale(new THREE.Vector3());assert.ok(Math.max(...scale.toArray())-Math.min(...scale.toArray())<1e-5,'Nonuniform bone ancestry remains');}
 assert.deepEqual(after.animations.map(c=>c.name),model.animations.map(c=>c.name));
 for(let c=0;c<model.animations.length;c++){
  assert.equal(after.animations[c].duration,model.animations[c].duration);assert.equal(after.animations[c].tracks.length,model.animations[c].tracks.length);
  for(let t=0;t<model.animations[c].tracks.length;t++){assert.equal(after.animations[c].tracks[t].name,model.animations[c].tracks[t].name);assert.deepEqual(after.animations[c].tracks[t].times,model.animations[c].tracks[t].times);}
 }
 return {sourceSha256:json.extras.reviewedRigScaleRepair.sourceSha256,sha256:after.sha256,maxBindError,retargetedChannels};
}
if(process.argv[1]&&resolve(process.argv[1])===resolve(import.meta.filename))console.log(await normalizeReviewedPetRigScale(resolve(process.argv[2]),resolve(process.argv[3])));
