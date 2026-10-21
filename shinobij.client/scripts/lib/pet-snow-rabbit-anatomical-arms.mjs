/** Anatomically fit Snow Rabbit's six arm frames and preserve the sculpt and all performances.
 * The bounded seam pairs were measured by the unchanged full-surface audit; they are not an art approval. */
import{readFile}from'node:fs/promises';import assert from'node:assert/strict';import{createHash}from'node:crypto';
import * as T from'three';import{GLTFLoader}from'three/examples/jsm/loaders/GLTFLoader.js';import{MeshoptDecoder}from'meshoptimizer';
import{parseStudioGlb,encodeStudioGlb,align4}from'./pet-studio-glb.mjs';import{repairPetSkinEdges}from'../../src/lib/pet-skin-weight-repair.ts';
const sha=b=>createHash('sha256').update(b).digest('hex');
export async function repairSnowRabbitArmRig(input,originalInput){
 const recipe=JSON.parse(await readFile(new URL('../fixtures/pet-snow-rabbit-anatomical-arms/measured-seam-recipe.json',import.meta.url)));
 assert.equal(sha(input),recipe.pins.source,'Unexpected Snow Rabbit source');assert.equal(sha(originalInput),recipe.pins.original,'Unexpected original anatomical ownership');
 const c={id:'standard-1',hash:"6576db9e525d89f513c1cffc86ee3cc1e8262a6fc0fb2401de6f891bc2303d23",points:[[.13,-.08,.035],[.18,-.17,.035],[.235,-.25,.065]],top:[-.09,-.04],back:[-.04,-.02],front:[.13,.155],elbow:[-.19,-.14],hand:[-.265,-.225]};
 const smooth=(lo,hi,x)=>{const t=Math.max(0,Math.min(1,(x-lo)/(hi-lo)));return t*t*(3-2*t);};
  const m=await loadBytes(input),original=await loadBytes(originalInput),mesh=m.meshes[0],old=original.meshes[0],a=mesh.geometry.attributes,oa=old.geometry.attributes;assert.equal(m.sha256,c.hash);assert.equal(a.position.count,oa.position.count);
 const bind=Array.from({length:a.position.count},(_,v)=>mesh.getVertexPosition(v,new T.Vector3()).applyMatrix4(mesh.matrixWorld)),{json,bin}=parseStudioGlb(input),skin=json.skins[0],correction=mesh.skeleton.bones[0].matrixWorld.clone().multiply(mesh.skeleton.boneInverses[0]),limbs=[],armIds=new Set();let binary=bin;
 for(const[side,sign]of[['L',1],['R',-1]]){const ids=[];for(const[k,part]of['upper_arm','forearm','hand'].entries()){const index=mesh.skeleton.bones.findIndex(b=>b.name===part+side);assert.ok(index>=0);armIds.add(index);ids.push(index);const bone=mesh.skeleton.bones[index],target=new T.Vector3(...c.points[k]);target.x*=sign;const p=bone.parent.worldToLocal(target);bone.position.copy(p);m.update();json.nodes[skin.joints[index]].translation=p.toArray();mesh.skeleton.boneInverses[index].copy(bone.matrixWorld).invert().multiply(correction);}limbs.push(ids);}
 const chest=mesh.skeleton.bones.findIndex(b=>b.name==='chest'),joints=new Uint8Array(a.position.count*4),weights=new Float32Array(a.position.count*4);let changed=0;
 for(let v=0;v<a.position.count;v++){const p=bind[v];let originalHead=0;for(let k=0;k<4;k++)if(old.skeleton.bones[oa.skinIndex.getComponent(v,k)].name==='head')originalHead+=oa.skinWeight.getComponent(v,k);
  const amount=smooth(.125+.55*(-.16-p.y)-.008,.125+.55*(-.16-p.y)+.008,Math.abs(p.x-.007))*(1-smooth(...c.top,p.y))*smooth(-.37,-.34,p.y)*smooth(...c.back,p.z)*(1-smooth(...c.front,p.z))*(1-smooth(.1,.35,originalHead));
  const values=new Map(),add=(j,w)=>values.set(j,(values.get(j)??0)+w);
  // Refit only the visible arm surface. Former stray arm influence on cloth
  // and torso is returned to chest before changing the anatomical rest frames.
  for(let k=0;k<4;k++){const j=a.skinIndex.getComponent(v,k),w=a.skinWeight.getComponent(v,k)*(1-amount);add(armIds.has(j)?chest:j,w);}
  const ids=limbs[p.x>=0?0:1],lower=1-smooth(...c.elbow,p.y),hand=1-smooth(...c.hand,p.y);add(ids[0],amount*(1-lower));add(ids[1],amount*lower*(1-hand));add(ids[2],amount*lower*hand);
  const ordered=[...values].filter(([,w])=>w>0).sort((a,b)=>b[1]-a[1]),floor=ordered[4]?.[1]??0,kept=ordered.slice(0,4).map(([j,w])=>[j,w-floor]),sum=kept.reduce((n,[,w])=>n+w,0);assert.ok(sum>0);for(const[k,[j,w]]of kept.entries()){joints[4*v+k]=j;weights[4*v+k]=w/sum;}if(amount>0)changed++;
 }
 function append(array,type,width,componentType=5126){const b=Buffer.from(array.buffer,array.byteOffset,array.byteLength),offset=align4(binary.length);binary=Buffer.concat([binary,Buffer.alloc(offset-binary.length),b]);const bufferView=json.bufferViews.push({buffer:0,byteOffset:offset,byteLength:b.length})-1;return json.accessors.push({bufferView,componentType,count:array.length/width,type})-1;}
 json.meshes[0].primitives[0].attributes.JOINTS_0=append(joints,'VEC4',4,5121);json.meshes[0].primitives[0].attributes.WEIGHTS_0=append(weights,'VEC4',4);skin.inverseBindMatrices=append(Float32Array.from(mesh.skeleton.boneInverses.flatMap(m=>m.toArray())),'MAT4',16);json.buffers[0].byteLength=align4(binary.length);

 let output=encodeStudioGlb(json,binary);
 for(const pass of recipe.passes){
  assert.equal(sha(output),pass.inputSha256,'Measured seam input changed');const model=await loadBytes(output),surface=model.meshes[0],parsed=parseStudioGlb(output),head=surface.skeleton.bones.findIndex(b=>b.name==='head'),repaired=repairPetSkinEdges(surface.geometry,surface.skeleton.bones.length,pass.pairs,head).geometry;let seamBin=parsed.bin;
  const add=(array,componentType)=>{const bytes=Buffer.from(array.buffer,array.byteOffset,array.byteLength),offset=align4(seamBin.length);seamBin=Buffer.concat([seamBin,Buffer.alloc(offset-seamBin.length),bytes]);const bufferView=parsed.json.bufferViews.push({buffer:0,byteOffset:offset,byteLength:bytes.length})-1;return parsed.json.accessors.push({bufferView,componentType,type:'VEC4',count:array.length/4})-1;};
  parsed.json.meshes[0].primitives[0].attributes.JOINTS_0=add(Uint16Array.from(repaired.attributes.skinIndex.array),5123);parsed.json.meshes[0].primitives[0].attributes.WEIGHTS_0=add(Float32Array.from(repaired.attributes.skinWeight.array),5126);parsed.json.buffers[0].byteLength=align4(seamBin.length);output=encodeStudioGlb(parsed.json,seamBin);repaired.dispose();surface.geometry.dispose();
 }
 assert.equal(sha(output),recipe.expectedOutputSha256,'Rabbit review candidate no longer reproduces');
 for(const model of[m,original])for(const mesh of model.meshes)mesh.geometry.dispose();
 return{bytes:output,report:{sourceSha256:sha(input),originalSha256:sha(originalInput),outputSha256:sha(output),fittedRestFrames:6,measuredSeamPasses:recipe.passes.length,changedArmSurfaceVertices:changed,sculptAndAuthoredAnimationStreamsChanged:false,visualApproval:false}};
}
async function loadBytes(bytes){
 const {json,bin}=parseStudioGlb(bytes),copy=structuredClone(json);copy.materials=[];copy.images=[];copy.textures=[];for(const mesh of copy.meshes)for(const p of mesh.primitives)delete p.material;await MeshoptDecoder.ready;const encoded=encodeStudioGlb(copy,bin),gltf=await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(encoded.buffer.slice(encoded.byteOffset,encoded.byteOffset+encoded.byteLength),'');const meshes=[];gltf.scene.traverse(n=>{if(n.isSkinnedMesh)meshes.push(n);});assert.equal(meshes.length,1);const update=()=>{gltf.scene.updateMatrixWorld(true);meshes.forEach(m=>m.skeleton.update());};update();return {...gltf,meshes,update,sha256:sha(bytes)};
}
