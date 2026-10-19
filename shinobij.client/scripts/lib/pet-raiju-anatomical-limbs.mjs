/** Fit four visible legs while retaining all original bone frames for the face, tail and upper body. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import * as T from 'three';
import * as THREE from 'three';
import {parseStudioGlb,encodeStudioGlb,align4} from './pet-studio-glb.mjs';
import {compactGlbDelivery} from '../compact-glb-delivery.mjs';
import {createCharacterRig,readCharacterTake,finishCharacterTake} from './pet-character-motion.mjs';
import {studioTangents} from './pet-studio-curves.mjs';
import {repairPetSkinWeights,repairPetSkinEdges,packContinuousPetSkinWeights} from '../../src/lib/pet-skin-weight-repair.ts';

export async function repairRaijuAnatomicalLimbs(bytes){
const sourceSha256=createHash('sha256').update(bytes).digest('hex');if(sourceSha256!=='c9be63e82a62593fea2eb5702176bfbf543ffe73783707e15c531f9f4a1fe153')throw Error('Unexpected supported Raiju neck source');
const m=await loadRaijuBytes(bytes),mesh=m.meshes[0],{json,bin}=parseStudioGlb(bytes),rig=createCharacterRig(json),skin=json.skins[0],maps={"paws":{"frontL":{"worldCenter":[0.1271145526589342,-0.48847628049879704,0.3210978623959877]},"frontR":{"worldCenter":[-0.13088832479372586,-0.4882956389841474,0.32103764786137]},"hindL":{"worldCenter":[0.10850835520043439,-0.4880848404561715,-0.2713799637435393]},"hindR":{"worldCenter":[-0.11309501927338146,-0.4882654246415262,-0.2706273052254544]}}};m.sha256=sourceSha256;
let binary=bin;const legs=[],smooth=(a,b,x)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);};
const correction=mesh.skeleton.bones[0].matrixWorld.clone().multiply(mesh.skeleton.boneInverses[0]),inverseBinds=mesh.skeleton.boneInverses.flatMap(x=>x.toArray());
for(const part of ['front','hind'])for(const side of ['L','R']){
 const center=new T.Vector3().fromArray(maps.paws[part+side].worldCenter),upper=center.clone(),knee=center.clone(),paw=center.clone();upper.y=part==='front'?-.12:-.16;upper.z+=part==='front'?-.055:.065;knee.y=-.34;knee.z+=part==='front'?-.02:.035;paw.y=center.y;
 let parentId=rig.byName.get(part==="front"?"chest":"pelvis"),parentWorld=rig.nodes[parentId].matrixWorld.clone();const joints=[];
 for(const [i,target]of [upper,knee,paw].entries()){
  const section=["upper","lower","paw"][i],oldId=rig.byName.get(part+"_"+section+"."+side);json.nodes[oldId].name="legacy_"+json.nodes[oldId].name;
  const world=new T.Matrix4().makeTranslation(...target.toArray()),local=parentWorld.clone().invert().multiply(world),p=new T.Vector3(),q=new T.Quaternion(),s=new T.Vector3();local.decompose(p,q,s);
  const id=json.nodes.push({name:part+"_"+section+"."+side,translation:p.toArray(),rotation:q.toArray(),scale:s.toArray()})-1;(json.nodes[parentId].children??=[]).push(id);joints.push(skin.joints.length);skin.joints.push(id);world.clone().invert().multiply(correction).toArray(inverseBinds,joints.at(-1)*16);parentId=id;parentWorld=world;
 }
 legs.push({part,side,center,joints,upper:upper.toArray(),knee:knee.toArray(),paw:paw.toArray()});
}
function append(array,type,width,componentType=5126){const b=Buffer.from(array.buffer,array.byteOffset,array.byteLength),offset=align4(binary.length);binary=Buffer.concat([binary,Buffer.alloc(offset-binary.length),b]);const view=json.bufferViews.push({buffer:0,byteOffset:offset,byteLength:b.length})-1;return json.accessors.push({bufferView:view,componentType,count:array.length/width,type})-1;}
const a=mesh.geometry.attributes,head=mesh.skeleton.bones.findIndex(b=>b.name==='head'),joints=new Uint8Array(a.position.count*4),weights=new Float32Array(a.position.count*4);let changed=0;
for(let v=0;v<a.position.count;v++){
 const p=mesh.getVertexPosition(v,new T.Vector3()).applyMatrix4(mesh.matrixWorld),old=new Map();let hw=0;for(let k=0;k<4;k++){const j=a.skinIndex.getComponent(v,k),w=a.skinWeight.getComponent(v,k);old.set(j,(old.get(j)??0)+w);if(j===head)hw+=w;}
 const low=1-smooth(-.34,-.14,p.y),shares=legs.map(l=>{const t=1-smooth(-.44,-.20,p.y),z=l.upper[2]*(1-t)+l.paw[2]*t,r=.075+.035*t;return 1-smooth(r,r+.07,Math.hypot(p.x-l.center.x,p.z-z));}),headGuard=1-smooth(-.42,-.30,p.y)+smooth(-.42,-.30,p.y)*(1-hw)**2,share=low*headGuard*(1-shares.reduce((product,s)=>product*(1-s),1)),mix=shares.map(s=>s**8),sum=mix.reduce((s,w)=>s+w,0),influences=new Float32Array(skin.joints.length);
 for(const[j,w]of old)influences[j]+=w*(1-share);
 if(share>0){const lower=1-smooth(-.36,-.19,p.y),paw=1-smooth(-.44,-.37,p.y);for(const[i,l]of legs.entries()){const w=share*mix[i]/sum;influences[l.joints[0]]+=w*(1-lower);influences[l.joints[1]]+=w*lower*(1-paw);influences[l.joints[2]]+=w*lower*paw;}changed++;}
 const packed=packContinuousPetSkinWeights(influences);for(let k=0;k<4;k++){joints[v*4+k]=packed.joints[k]??0;weights[v*4+k]=packed.weights[k]??0;}
}
const g=mesh.geometry.clone();g.setAttribute('skinIndex',new T.Uint8BufferAttribute(joints,4));g.setAttribute('skinWeight',new T.Float32BufferAttribute(weights,4));const softened=repairPetSkinWeights(g,skin.joints.length,head,48).geometry;
for(let v=0;v<a.position.count;v++){const p=mesh.getVertexPosition(v,new T.Vector3()).applyMatrix4(mesh.matrixWorld),blend=smooth(-.46,-.36,p.y)*(1-smooth(-.21,-.13,p.y));if(!blend)continue;let hw=0;for(let k=0;k<4;k++)if(joints[v*4+k]===head)hw+=weights[v*4+k];if(hw>.999)continue;const values=new Float32Array(skin.joints.length);for(let k=0;k<4;k++){values[joints[v*4+k]]+=weights[v*4+k]*(1-blend);values[softened.attributes.skinIndex.getComponent(v,k)]+=softened.attributes.skinWeight.getComponent(v,k)*blend;}const packed=packContinuousPetSkinWeights(values);for(let k=0;k<4;k++){joints[v*4+k]=packed.joints[k]??0;weights[v*4+k]=packed.weights[k]??0;}}
g.dispose();softened.dispose();const seamSurface=mesh.geometry.clone();seamSurface.setAttribute('skinIndex',new T.Uint8BufferAttribute(joints,4));seamSurface.setAttribute('skinWeight',new T.Float32BufferAttribute(weights,4));const seam=repairPetSkinEdges(seamSurface,skin.joints.length,[[23038,23043],[23037,22993],[23048,23042]],head).geometry;for(let v=0;v<a.position.count;v++)for(let k=0;k<4;k++){joints[v*4+k]=seam.attributes.skinIndex.getComponent(v,k);weights[v*4+k]=seam.attributes.skinWeight.getComponent(v,k);}seamSurface.dispose();seam.dispose();const primitive=json.meshes[0].primitives[0];primitive.attributes.JOINTS_0=append(joints,'VEC4',4,5121);primitive.attributes.WEIGHTS_0=append(weights,'VEC4',4);skin.inverseBindMatrices=append(Float32Array.from(inverseBinds),'MAT4',16);
const nextRig=createCharacterRig(json),gaitReports=[];
for(const name of ['idle','walk','gallop','guard','rest']){
 const clip=json.animations.find(c=>c.name===name),take=await readCharacterTake(json,bin,clip),done=finishCharacterTake(nextRig,take,name,'pouncer',false,.55),allowed=new Set(nextRig.chains.flatMap(c=>c.ids).map(id=>`${id}:rotation`).concat(`${nextRig.byName.get('root')}:translation`)),input=append(done.times,'SCALAR',1);json.accessors[input].min=[0];json.accessors[input].max=[take.duration];
 for(const c of done.channels.filter(c=>allowed.has(`${c.node}:${c.path}`))){const width=c.path==='rotation'?4:3,vs=Float32Array.from(c.values);if(width===4)for(let i=1;i<done.times.length;i++){let dot=0;for(let k=0;k<4;k++)dot+=vs[(i-1)*4+k]*vs[i*4+k];if(dot<0)for(let k=0;k<4;k++)vs[i*4+k]*=-1;}const tangents=studioTangents(done.times,vs,width,done.cyclic),out=new Float32Array(done.times.length*width*3);for(let i=0;i<done.times.length;i++)for(let k=0;k<width;k++){out[i*width*3+k]=out[i*width*3+width*2+k]=tangents[i*width+k];out[i*width*3+width+k]=vs[i*width+k];}const sampler={input,output:append(out,width===4?'VEC4':'VEC3',width),interpolation:'CUBICSPLINE'},old=clip.channels.find(ch=>ch.target.node===c.node&&ch.target.path===c.path);if(old)clip.samplers[old.sampler]=sampler;else{clip.channels.push({sampler:clip.samplers.length,target:{node:c.node,path:c.path}});clip.samplers.push(sampler);}}
 gaitReports.push({name,maxContactError:Math.max(...done.contacts.map(c=>c.error))});
}
json.buffers[0].byteLength=align4(binary.length);json.extras.raijuAnatomicalLimbRepair={sourceSha256:m.sha256,changedVertices:changed,legs:legs.map(({center,...l})=>({...l,center:center.toArray()})),gaitReports};const out=compactGlbDelivery(encodeStudioGlb(json,binary)),sha=createHash('sha256').update(out).digest('hex');return {bytes:out,report:{sourceSha256,sha256:sha,anatomy:json.extras.raijuAnatomicalLimbRepair}};
}
async function loadRaijuBytes(bytes){
 const {GLTFLoader}=await import('three/examples/jsm/loaders/GLTFLoader.js'),{MeshoptDecoder}=await import('meshoptimizer');const{json,bin}=parseStudioGlb(bytes),copy=structuredClone(json);copy.materials=[];copy.images=[];copy.textures=[];for(const m of copy.meshes)for(const p of m.primitives)delete p.material;await MeshoptDecoder.ready;const encoded=encodeStudioGlb(copy,bin),gltf=await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(encoded.buffer.slice(encoded.byteOffset,encoded.byteOffset+encoded.byteLength),'');gltf.scene.updateMatrixWorld(true);const meshes=[];gltf.scene.traverse(n=>{if(n.isSkinnedMesh){n.skeleton.update();meshes.push(n);}});assert.equal(meshes.length,1);return{...gltf,meshes};
}
