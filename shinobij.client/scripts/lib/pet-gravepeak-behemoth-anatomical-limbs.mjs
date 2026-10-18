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

export async function repairGravepeakBehemothAnatomicalLimbs(bytes){
const sourceSha256=createHash('sha256').update(bytes).digest('hex');if(sourceSha256!=='c53623a720c54719c497077b33211008040f7d06c9d01986f17b014f22fe66fb')throw Error('Unexpected supported GravepeakBehemoth neck source');
const m=await loadGravepeakBehemothBytes(bytes),mesh=m.meshes[0],{json,bin}=parseStudioGlb(bytes),rig=createCharacterRig(json),skin=json.skins[0],maps={"paws":{"frontL":{"worldCenter":[0.487234863065707,-0.8231286228668411,0.45696656010129477]},"frontR":{"worldCenter":[-0.5438428820808812,-0.8231286215486009,0.4412960664545445]},"hindL":{"worldCenter":[0.3700323446763899,-0.8074724838443849,-0.6649161087472436]},"hindR":{"worldCenter":[-0.2821703201156935,-0.811415466697463,-0.6599873690223161]}}};m.sha256=sourceSha256;
let binary=bin;const legs=[],smooth=(a,b,x)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);};
const correction=mesh.skeleton.bones[0].matrixWorld.clone().multiply(mesh.skeleton.boneInverses[0]),inverseBinds=mesh.skeleton.boneInverses.flatMap(x=>x.toArray());
for(const part of ['front','hind'])for(const side of ['L','R']){
 const center=new T.Vector3().fromArray(maps.paws[part+side].worldCenter),upper=center.clone(),knee=center.clone(),paw=center.clone();upper.y=part==='front'?-.09:-.14;upper.z+=part==='front'?-.23:.093;knee.y=part==='front'?-.33:-.47;knee.z+=part==='front'?-.30:.081;paw.y=center.y+.035;
 let parentId=rig.byName.get(part==="front"?"chest":"pelvis"),parentWorld=rig.nodes[parentId].matrixWorld.clone();const joints=[];
 for(const [i,target]of [upper,knee,paw].entries()){
  const section=["upper","lower","paw"][i],oldName=(part==="front"?["upper_arm","forearm","hand"]:["thigh","shin","foot"])[i]+"."+side,oldId=rig.byName.get(oldName);assert.ok(oldId!==undefined,oldName);json.nodes[oldId].name="legacy_"+json.nodes[oldId].name;
  const world=new T.Matrix4().makeTranslation(...target.toArray()),local=parentWorld.clone().invert().multiply(world),p=new T.Vector3(),q=new T.Quaternion(),s=new T.Vector3();local.decompose(p,q,s);
  const id=json.nodes.push({name:part+"_"+section+"."+side,translation:p.toArray(),rotation:q.toArray(),scale:s.toArray()})-1;(json.nodes[parentId].children??=[]).push(id);joints.push(skin.joints.length);skin.joints.push(id);world.clone().invert().multiply(correction).toArray(inverseBinds,joints.at(-1)*16);parentId=id;parentWorld=world;
 }
 legs.push({part,side,center,joints,upper:upper.toArray(),knee:knee.toArray(),paw:paw.toArray()});
}
function append(array,type,width,componentType=5126){const b=Buffer.from(array.buffer,array.byteOffset,array.byteLength),offset=align4(binary.length);binary=Buffer.concat([binary,Buffer.alloc(offset-binary.length),b]);const view=json.bufferViews.push({buffer:0,byteOffset:offset,byteLength:b.length})-1;return json.accessors.push({bufferView:view,componentType,count:array.length/width,type})-1;}
const a=mesh.geometry.attributes,head=mesh.skeleton.bones.findIndex(b=>b.name==='head'),joints=new Uint8Array(a.position.count*4),weights=new Float32Array(a.position.count*4);let changed=0,legacyReboundVertices=0,headNeckLegCleanupVertices=0;
for(let v=0;v<a.position.count;v++){
 const p=mesh.getVertexPosition(v,new T.Vector3()).applyMatrix4(mesh.matrixWorld);p.y*=.5;const old=new Map();let hw=0;for(let k=0;k<4;k++){const j=a.skinIndex.getComponent(v,k),w=a.skinWeight.getComponent(v,k);old.set(j,(old.get(j)??0)+w);if(j===head)hw+=w;}
 // Preserve fully rigid head vertices before any limb cleanup, including the lower cheek transition.
 if(hw>=.999999){for(let k=0;k<4;k++){joints[v*4+k]=a.skinIndex.getComponent(v,k);weights[v*4+k]=a.skinWeight.getComponent(v,k);}continue;}
 const low=1-smooth(-.03,.10,p.y),shares=legs.map(l=>{const t=1-smooth(-.36,-.06,p.y),z=l.upper[2]*(1-t)+l.paw[2]*t,r=l.part==='front'?.28:.22;return 1-smooth(r,r+.12,Math.hypot(p.x-l.center.x,p.z-z));}),headGuard=1-smooth(-.36,-.20,p.y)+smooth(-.26,-.14,p.y)*(1-hw)**2,share=low*headGuard*(1-shares.reduce((product,s)=>product*(1-s),1)),mix=shares.map(s=>s**8),sum=mix.reduce((s,w)=>s+w,0),influences=new Float32Array(skin.joints.length);
 let legacyRebound=false,headNeckCleaned=false;
 for(const[j,w]of old){
 const name=mesh.skeleton.bones[j].name,legacy=name.match(/^(upper_arm|forearm|hand|thigh|shin|foot)[LR]$/),leg=legacy?[null,['upper_arm','forearm','hand'].includes(legacy[1])?'front':'hind',({upper_arm:'upper',forearm:'lower',hand:'paw',thigh:'upper',shin:'lower',foot:'paw'})[legacy[1]]]:null,near=legs.reduce((best,l,i)=>shares[i]>(best.share??-1)?{leg:l,share:shares[i]}:best,{}),parent=skin.joints.indexOf(rig.byName.get(near.leg.part==='front'?'chest':'pelvis'));
 if(leg){if(w>0)legacyRebound=true;const candidates=legs,scores=candidates.map(l=>1/Math.max(.015,Math.hypot(p.x-l.center.x,p.z-l.upper[2]))**8),total=scores.reduce((a,b)=>a+b,0),section=['upper','lower','paw'].indexOf(leg[2]),legShare=(1-smooth(-.10,.02,p.y))*(1-(1-smooth(.10,.22,Math.abs(p.x)))*smooth(-.30,-.23,p.y));for(const[i,l]of candidates.entries())influences[l.joints[section]]+=w*(1-share)*legShare*scores[i]/total;influences[parent]+=w*(1-share)*(1-legShare);}
 else if((name==='head'||name==='neck')&&near.share>0){const clean=(1-smooth(-.17,.03,p.y))*near.share;if(w*clean>0)headNeckCleaned=true;influences[j]+=w*(1-share)*(1-clean);influences[parent]+=w*(1-share)*clean;}
 else influences[j]+=w*(1-share);
}
 if(legacyRebound)legacyReboundVertices++;if(headNeckCleaned)headNeckLegCleanupVertices++;
 if(share>0){for(const[i,l]of legs.entries()){const lower=1-smooth(-.24,-.12,p.y),paw=1-smooth(-.38,-.32,p.y),w=share*mix[i]/sum;influences[l.joints[0]]+=w*(1-lower);influences[l.joints[1]]+=w*lower*(1-paw);influences[l.joints[2]]+=w*lower*paw;}changed++;}
 if(p.y<-.355&&Math.max(...shares)>0){const near=legs.reduce((a,l)=>Math.hypot(p.x-l.center.x,p.z-l.center.z)<Math.hypot(p.x-a.center.x,p.z-a.center.z)?l:a,legs[0]),isolation=1-smooth(-.395,-.355,p.y);for(let j=0;j<influences.length;j++)influences[j]*=1-isolation;influences[near.joints[2]]+=isolation;}
 const packed=packContinuousPetSkinWeights(influences);for(let k=0;k<4;k++){joints[v*4+k]=packed.joints[k]??0;weights[v*4+k]=packed.weights[k]??0;}
}
const g=mesh.geometry.clone();g.setAttribute('skinIndex',new T.Uint8BufferAttribute(joints,4));g.setAttribute('skinWeight',new T.Float32BufferAttribute(weights,4));const softened=repairPetSkinWeights(g,skin.joints.length,head,48).geometry;
for(let v=0;v<a.position.count;v++){const p=mesh.getVertexPosition(v,new T.Vector3()).applyMatrix4(mesh.matrixWorld);p.y*=.5;const blend=smooth(-.385,-.28,p.y)*(1-smooth(-.03,.10,p.y));if(!blend)continue;let hw=0;for(let k=0;k<4;k++)if(joints[v*4+k]===head)hw+=weights[v*4+k];if(hw>.999)continue;const values=new Float32Array(skin.joints.length);for(let k=0;k<4;k++){values[joints[v*4+k]]+=weights[v*4+k]*(1-blend);values[softened.attributes.skinIndex.getComponent(v,k)]+=softened.attributes.skinWeight.getComponent(v,k)*blend;}const packed=packContinuousPetSkinWeights(values);for(let k=0;k<4;k++){joints[v*4+k]=packed.joints[k]??0;weights[v*4+k]=packed.weights[k]??0;}}
g.dispose();softened.dispose();const primitive=json.meshes[0].primitives[0];primitive.attributes.JOINTS_0=append(joints,'VEC4',4,5121);primitive.attributes.WEIGHTS_0=append(weights,'VEC4',4);skin.inverseBindMatrices=append(Float32Array.from(inverseBinds),'MAT4',16);
const nextRig=createCharacterRig(json),gaitReports=[];
for(const name of ['idle','walk','gallop','guard','rest']){
 const clip=json.animations.find(c=>c.name===name),take=await readCharacterTake(json,bin,clip),done=finishCharacterTake(nextRig,take,name,'armored',false,.45,.45),allowed=new Set(nextRig.chains.flatMap(c=>c.ids).map(id=>`${id}:rotation`).concat(`${nextRig.byName.get('root')}:translation`)),input=append(done.times,'SCALAR',1);json.accessors[input].min=[0];json.accessors[input].max=[take.duration];
 for(const c of done.channels.filter(c=>allowed.has(`${c.node}:${c.path}`))){const width=c.path==='rotation'?4:3,vs=Float32Array.from(c.values);if(width===4)for(let i=1;i<done.times.length;i++){let dot=0;for(let k=0;k<4;k++)dot+=vs[(i-1)*4+k]*vs[i*4+k];if(dot<0)for(let k=0;k<4;k++)vs[i*4+k]*=-1;}const tangents=studioTangents(done.times,vs,width,done.cyclic),out=new Float32Array(done.times.length*width*3);for(let i=0;i<done.times.length;i++)for(let k=0;k<width;k++){out[i*width*3+k]=out[i*width*3+width*2+k]=tangents[i*width+k];out[i*width*3+width+k]=vs[i*width+k];}const sampler={input,output:append(out,width===4?'VEC4':'VEC3',width),interpolation:'CUBICSPLINE'},old=clip.channels.find(ch=>ch.target.node===c.node&&ch.target.path===c.path);if(old)clip.samplers[old.sampler]=sampler;else{clip.channels.push({sampler:clip.samplers.length,target:{node:c.node,path:c.path}});clip.samplers.push(sampler);}}
 gaitReports.push({name,strideScale:.45,verticalScale:.45,maxContactError:Math.max(...done.contacts.map(c=>c.error))});
}
json.extras.properAnimationRig="quadruped";json.extras.characterMotion.supportChains=4;json.buffers[0].byteLength=align4(binary.length);json.extras.gravepeakBehemothAnatomicalLimbRepair={sourceSha256:m.sha256,changedVertices:changed,legacyReboundVertices,headNeckLegCleanupVertices,legacySupportBinding:"Original front/hind influences rebound continuously onto the fitted same-section visible leg joints using sculpt-side proximity; lower-leg neck/head influence feathers onto the nearest supporting torso parent.",legs:legs.map(({center,...l})=>({...l,center:center.toArray()})),gaitReports};const out=compactGlbDelivery(encodeStudioGlb(json,binary)),sha=createHash('sha256').update(out).digest('hex');return {bytes:out,report:{sourceSha256,sha256:sha,anatomy:json.extras.gravepeakBehemothAnatomicalLimbRepair}};
}
async function loadGravepeakBehemothBytes(bytes){
 const {GLTFLoader}=await import('three/examples/jsm/loaders/GLTFLoader.js'),{MeshoptDecoder}=await import('meshoptimizer');const{json,bin}=parseStudioGlb(bytes),copy=structuredClone(json);copy.materials=[];copy.images=[];copy.textures=[];for(const m of copy.meshes)for(const p of m.primitives)delete p.material;await MeshoptDecoder.ready;const encoded=encodeStudioGlb(copy,bin),gltf=await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(encoded.buffer.slice(encoded.byteOffset,encoded.byteOffset+encoded.byteLength),'');gltf.scene.updateMatrixWorld(true);const meshes=[];gltf.scene.traverse(n=>{if(n.isSkinnedMesh){n.skeleton.update();meshes.push(n);}});assert.equal(meshes.length,1);return{...gltf,meshes};
}
