import {createHash} from 'node:crypto';
import * as T from 'three';
import {parseStudioGlb,encodeStudioGlb,align4} from './pet-studio-glb.mjs';
import {createCharacterRig,readCharacterTake,sampleChannel,finishCharacterTake,solveFoot} from './pet-character-motion.mjs';
import {studioTangents} from './pet-studio-curves.mjs';
import {compactGlbDelivery} from '../compact-glb-delivery.mjs';
import {packContinuousPetSkinWeights} from '../../src/lib/pet-skin-weight-repair.ts';

/** Fit the two visible legs, remove opposite-foot contamination, and solve the
 * entire support chain for movement and techniques. Original bones remain. */
export async function repairAshCrownPhoenixAnatomicalLegs(bytes) {
 const sourceSha256=createHash('sha256').update(bytes).digest('hex');
 if(sourceSha256!=='8d51681e018a59bbfd9e8c29c694ccf6d3550e329fc91f13136880fcd0f7e83d')throw Error('Unexpected AshCrownPhoenix leg source');
 const {json,bin}=parseStudioGlb(bytes),model=await load(bytes),mesh=model.meshes[0],rig=createCharacterRig(json),skin=json.skins[0],a=mesh.geometry.attributes;
 const inverse=mesh.skeleton.boneInverses.flatMap(x=>x.toArray()),correction=mesh.skeleton.bones[0].matrixWorld.clone().multiply(mesh.skeleton.boneInverses[0]);
 const R=mesh.skeleton.bones.find(b=>b.name==='thighL').getWorldQuaternion(new T.Quaternion());
 let binary=bin;
 const append=(array,type,width,componentType=5126)=>{
  const b=Buffer.from(array.buffer,array.byteOffset,array.byteLength),offset=align4(binary.length);
  binary=Buffer.concat([binary,Buffer.alloc(offset-binary.length),b]);
  const view=json.bufferViews.push({buffer:0,byteOffset:offset,byteLength:b.length})-1;
  return json.accessors.push({bufferView:view,componentType,count:array.length/width,type})-1;
 };
 const legs=[];
 for(const [side,sign]of [['L',1],['R',-1]]){
  let parent=rig.byName.get('pelvis'),parentWorld=rig.nodes[parent].matrixWorld.clone();
  const joints=[],nodes=[],legacy=[];
  for(const [section,target]of [['thigh',[sign*.17,-.42,.22]],['shin',[sign*.17,-.68,.27]],['foot',[sign*.17,-.918,.45]]]){
   const old=rig.byName.get(section+'.'+side);legacy.push(old);json.nodes[old].name='legacy_'+json.nodes[old].name;
   const world=new T.Matrix4().compose(new T.Vector3().fromArray(target),R,new T.Vector3(1,1,1)),local=parentWorld.clone().invert().multiply(world),p=new T.Vector3(),q=new T.Quaternion(),s=new T.Vector3();local.decompose(p,q,s);
   const node=json.nodes.push({name:section+'.'+side,translation:p.toArray(),rotation:q.toArray(),scale:s.toArray()})-1;
   (json.nodes[parent].children??=[]).push(node);nodes.push(node);joints.push(skin.joints.length);skin.joints.push(node);
   world.clone().invert().multiply(correction).toArray(inverse,joints.at(-1)*16);parent=node;parentWorld=world;
  }
  legs.push({side,sign,joints,nodes,legacy});
 }
 const smooth=(lo,hi,x)=>{const t=Math.max(0,Math.min(1,(x-lo)/(hi-lo)));return t*t*(3-2*t);};
 const joints=new Uint8Array(a.position.count*4),weights=new Float32Array(a.position.count*4),pelvis=skin.joints.indexOf(rig.byName.get('pelvis'));
 let changedVertices=0;
 for(let v=0;v<a.position.count;v++){
  const p=mesh.getVertexPosition(v,new T.Vector3()).applyMatrix4(mesh.matrixWorld),values=new Float32Array(skin.joints.length);
  const t=1-smooth(-.85,-.42,p.y),z=.22+(.45-.22)*t,sideShare=smooth(.015,.075,Math.abs(p.x));
  const near=1-smooth(.11+.07*t,.19+.10*t,Math.hypot(Math.abs(p.x)-.17,p.z-z));
  const low=1-smooth(-.45,-.24,p.y),share=low*near*sideShare;
  let changed=share>0;
  for(let k=0;k<4;k++){
   const j=a.skinIndex.getComponent(v,k),w=a.skinWeight.getComponent(v,k),name=mesh.skeleton.bones[j].name,match=name.match(/^(thigh|shin|foot)[LR]$/);
   if(match){
    const l=legs[p.x>=0?0:1],section=['thigh','shin','foot'].indexOf(match[1]),legShare=(1-smooth(-.40,-.20,p.y))*near*sideShare;
    values[l.joints[section]]+=w*(1-share)*legShare;values[pelvis]+=w*(1-share)*(1-legShare);if(w)changed=true;
   }else values[j]+=w*(1-share);
  }
  const l=legs[p.x>=0?0:1],lower=1-smooth(-.73,-.56,p.y),foot=1-smooth(-.87,-.79,p.y);
  values[l.joints[0]]+=share*(1-lower);values[l.joints[1]]+=share*lower*(1-foot);values[l.joints[2]]+=share*lower*foot;
  const isolation=(1-smooth(-.86,-.78,p.y))*smooth(.02,.16,p.z)*smooth(0,.025,Math.abs(p.x));
  if(isolation){for(let j=0;j<values.length;j++)values[j]*=1-isolation;values[l.joints[2]]+=isolation;changed=true;}
  if(!changed){for(let k=0;k<4;k++){joints[v*4+k]=a.skinIndex.getComponent(v,k);weights[v*4+k]=a.skinWeight.getComponent(v,k);}continue;}
  const packed=packContinuousPetSkinWeights(values);for(let k=0;k<4;k++){joints[v*4+k]=packed.joints[k]??0;weights[v*4+k]=packed.weights[k]??0;}changedVertices++;
 }
 const primitive=json.meshes[0].primitives[0];primitive.attributes.JOINTS_0=append(joints,'VEC4',4,5121);primitive.attributes.WEIGHTS_0=append(weights,'VEC4',4);skin.inverseBindMatrices=append(Float32Array.from(inverse),'MAT4',16);
 const fitted=createCharacterRig(json),reports=[];
 const writeStreams=(clip,times,streams,cyclic)=>{
  const input=append(times,'SCALAR',1);json.accessors[input].min=[0];json.accessors[input].max=[times.at(-1)];
  for(const stream of streams){
   const width=stream.path==='rotation'?4:3,vs=Float32Array.from(stream.values);
   if(width===4)for(let i=1;i<times.length;i++){let dot=0;for(let k=0;k<4;k++)dot+=vs[(i-1)*4+k]*vs[i*4+k];if(dot<0)for(let k=0;k<4;k++)vs[i*4+k]*=-1;}
   const tangent=studioTangents(times,vs,width,cyclic),out=new Float32Array(times.length*width*3);
   for(let i=0;i<times.length;i++)for(let k=0;k<width;k++){out[i*width*3+k]=out[i*width*3+width*2+k]=tangent[i*width+k];out[i*width*3+width+k]=vs[i*width+k];}
   const sampler={input,output:append(out,width===4?'VEC4':'VEC3',width),interpolation:'CUBICSPLINE'},prior=clip.channels.find(c=>c.target.node===stream.node&&c.target.path===stream.path);
   if(prior)clip.samplers[prior.sampler]=sampler;else{clip.channels.push({sampler:clip.samplers.length,target:{node:stream.node,path:stream.path}});clip.samplers.push(sampler);}
  }
 };
 const pose=(take,p)=>{fitted.reset();for(const c of take.channels){const value=sampleChannel(c,p),n=fitted.nodes[c.node];if(c.path==='rotation')n.quaternion.fromArray(value);else if(c.path==='translation')n.position.fromArray(value);else n.scale.fromArray(value);}fitted.scene.updateMatrixWorld(true);};
 for(const clip of json.animations){
  const take=await readCharacterTake(json,bin,clip),cyclic=['idle','walk','gallop','guard','rest'].includes(clip.name);
  if(cyclic){
   const done=finishCharacterTake(fitted,take,clip.name,'avian',false,.55,.45),allowed=new Set(fitted.chains.flatMap(c=>c.ids).map(id=>id+':rotation').concat(fitted.byName.get('root')+':translation'));
   writeStreams(clip,done.times,done.channels.filter(c=>allowed.has(c.node+':'+c.path)),true);
   reports.push({name:clip.name,kind:'supported-gait',keys:done.times.length,maximumContactError:Math.max(...done.contacts.map(c=>c.error))});continue;
  }
  const times=Float32Array.from({length:73},(_,i)=>i/72*take.duration),streams=legs.flatMap(l=>l.nodes.map((node,i)=>({node,path:'rotation',values:[],old:l.legacy[i]})));
  for(const time of times)for(const s of streams){const channel=take.channels.find(c=>c.node===s.old&&c.path==='rotation'),q=fitted.bind[s.node].q.clone();if(channel)q.multiply(rig.bind[s.old].q.clone().invert().multiply(new T.Quaternion().fromArray(sampleChannel(channel,time/take.duration))));s.values.push(...q.toArray());}
  writeStreams(clip,times,streams,false);
 }
 const root=fitted.byName.get('root'),chest=fitted.byName.get('chest'),pelvisNode=fitted.byName.get('pelvis');
 const pulse=(p,a,b,c)=>p<b?smooth(a,b,p):1-smooth(b,c,p);
 for(const name of ['attack','cast','idle_hitreact1']){
  const clip=json.animations.find(c=>c.name===name),take=await readCharacterTake(json,binary,clip),times=Float32Array.from({length:73},(_,i)=>i/72*take.duration),contacts=[];
  const streams=[{node:root,path:'translation',values:[]},...[chest,pelvisNode,...fitted.chains.flatMap(c=>c.ids)].map(node=>({node,path:'rotation',values:[]}))];
  for(const time of times){
   const p=time/take.duration;pose(take,p);const crouch=pulse(p,0,.28,.72),drive=pulse(p,.24,.48,.92),impact=pulse(p,0,.18,.82);
   fitted.nodes[pelvisNode].quaternion.copy(fitted.bind[pelvisNode].q);
   fitted.nodes[chest].quaternion.copy(fitted.bind[chest].q).multiply(new T.Quaternion().setFromAxisAngle(new T.Vector3(1,0,0),name==='idle_hitreact1'?-.045*impact:name==='cast'?-.035*crouch:.055*drive-.035*crouch));
   fitted.nodes[root].position.copy(fitted.bind[root].p).addScaledVector(fitted.chains[0].up,-.025-(name==='idle_hitreact1'?.012*impact:.015*crouch)).addScaledVector(fitted.chains[0].forward,name==='attack'?-.01*crouch+.025*drive:name==='idle_hitreact1'?-.018*impact:-.008*crouch);
   for(const chain of fitted.chains){for(const id of chain.ids)fitted.nodes[id].quaternion.copy(fitted.bind[id].q);const error=solveFoot(fitted,chain,chain.origin,chain.orientation);contacts.push(error);}
   for(const s of streams){const n=fitted.nodes[s.node];s.values.push(...(s.path==='rotation'?n.quaternion.toArray():n.position.toArray()));}
  }
  writeStreams(clip,times,streams,false);reports.push({name,kind:'planted-action',keys:times.length,tracks:streams.length,maximumContactError:Math.max(...contacts)});
 }
 json.buffers[0].byteLength=align4(binary.length);
 const report={revision:'20261018-ash-crown-phoenix-anatomical-legs-v1',sourceSha256,changedVertices,appendedJoints:6,originalBoneFramesAndInversesPreserved:true,legs:legs.map(({legacy,...l})=>l),clips:reports};
 json.extras.ashCrownPhoenixAnatomicalLegRepair=report;
 const packed=parseStudioGlb(compactGlbDelivery(encodeStudioGlb(json,binary)));packed.json.extras.properAnimationSourceBoundary={binLength:packed.bin.length,accessorCount:packed.json.accessors.length,bufferViewCount:packed.json.bufferViews.length};
 const result=encodeStudioGlb(packed.json,packed.bin);return {bytes:result,report:{...report,sha256:createHash('sha256').update(result).digest('hex')}};
}

async function load(bytes){
 const {GLTFLoader}=await import('three/examples/jsm/loaders/GLTFLoader.js'),{MeshoptDecoder}=await import('meshoptimizer'),{json,bin}=parseStudioGlb(bytes),copy=structuredClone(json);
 copy.materials=[];copy.images=[];copy.textures=[];for(const m of copy.meshes)for(const p of m.primitives)delete p.material;await MeshoptDecoder.ready;
 const encoded=encodeStudioGlb(copy,bin),g=await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(encoded.buffer.slice(encoded.byteOffset,encoded.byteOffset+encoded.byteLength),'');g.scene.updateMatrixWorld(true);const meshes=[];g.scene.traverse(n=>{if(n.isSkinnedMesh){n.skeleton.update();meshes.push(n);}});if(meshes.length!==1)throw Error('Unexpected Phoenix leg mesh count');return{...g,meshes};
}
