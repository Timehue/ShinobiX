import {createHash} from 'node:crypto';
import {Vector3,Matrix4} from 'three';
import {parseStudioGlb,encodeStudioGlb,align4} from './pet-studio-glb.mjs';
import {createCharacterRig,readCharacterTake,sampleChannel} from './pet-character-motion.mjs';
import {studioTangents} from './pet-studio-curves.mjs';
import {compactGlbDelivery} from '../compact-glb-delivery.mjs';

/** Preserve the serpent's proven idle support and tail articulation under its
 * authored neck/head action. Its short rear limbs cannot use Oni's IK pose. */
export async function repairMoonSerpentSupportedActions(bytes) {
 const sourceSha256=createHash('sha256').update(bytes).digest('hex');
 if(sourceSha256!=='30f2fa6e7259eb46eddf7e2a413bf76c0ef5db9d523143fd169065fc6e42d291')throw Error('Unexpected Moon Serpent source');
 const {json,bin}=parseStudioGlb(bytes),rig=createCharacterRig(json);
 const idle=await readCharacterTake(json,bin,json.animations.find(c=>c.name==='idle'));
 const legIds=new Set(rig.chains.flatMap(c=>c.ids)),rootId=rig.byName.get('root'),spineId=rig.byName.get('spine');
 const tail=idle.channels.filter(c=>c.path==='rotation'&&/^tail/.test(json.nodes[c.node].name));
 const body=[{node:rootId,path:'translation'},...[spineId,rig.byName.get('chest'),rig.byName.get('pelvis'),...legIds].map(node=>({node,path:'rotation'})),...tail.map(c=>({node:c.node,path:c.path}))];
 if(rig.chains.length!==4||body.length!==19||body.some(c=>c.node===undefined))throw Error('Unexpected support rig');
 let binary=bin;
 function append(values,type){
  const offset=align4(binary.length),b=Buffer.from(values.buffer,values.byteOffset,values.byteLength);binary=Buffer.concat([binary,Buffer.alloc(offset-binary.length),b]);
  const view=json.bufferViews.push({buffer:0,byteOffset:offset,byteLength:b.length})-1;
  return json.accessors.push({bufferView:view,componentType:5126,count:values.length/(type==='VEC4'?4:type==='VEC3'?3:1),type})-1;
 }
 const reports=[];
 for(const name of ['attack','cast','idle_hitreact1']){
  const clip=json.animations.find(c=>c.name===name),take=await readCharacterTake(json,bin,clip),times=Float32Array.from({length:49},(_,i)=>i/48*take.duration);
  const streams=body.map(c=>({node:c.node,path:c.path,values:[]})),contacts=[];
  for(const time of times){
   const p=time/take.duration;rig.reset();
   for(const c of take.channels){const v=sampleChannel(c,p),n=rig.nodes[c.node];if(c.path==='rotation')n.quaternion.fromArray(v);else if(c.path==='translation')n.position.fromArray(v);else n.scale.fromArray(v);}
   for(const c of body){const n=rig.nodes[c.node],t=tail.find(t=>t.node===c.node);if(t)n.quaternion.fromArray(sampleChannel(t,p));else if(c.path==='rotation')n.quaternion.copy(rig.bind[c.node].q);else n.position.copy(rig.bind[c.node].p);}
   rig.scene.updateMatrixWorld(true);
   for(const chain of rig.chains){const foot=rig.nodes[chain.ids[2]].getWorldPosition(new Vector3()).applyMatrix4(new Matrix4().copy(chain.frame.matrixWorld).invert());contacts.push({p,foot:rig.nodes[chain.ids[2]].name,error:foot.distanceTo(chain.origin)});}
   for(const s of streams){const n=rig.nodes[s.node];s.values.push(...(s.path==='rotation'?n.quaternion.toArray():n.position.toArray()));}
  }
  const inputAccessor=append(times,'SCALAR');json.accessors[inputAccessor].min=[0];json.accessors[inputAccessor].max=[take.duration];
  for(const s of streams){
   const width=s.path==='rotation'?4:3,values=Float32Array.from(s.values);
   if(width===4)for(let i=1;i<times.length;i++){let dot=0;for(let k=0;k<4;k++)dot+=values[(i-1)*4+k]*values[i*4+k];if(dot<0)for(let k=0;k<4;k++)values[i*4+k]*=-1;}
   const tangents=studioTangents(times,values,width,false),spline=new Float32Array(times.length*width*3);
   for(let i=0;i<times.length;i++)for(let k=0;k<width;k++){spline[i*width*3+k]=spline[i*width*3+width*2+k]=tangents[i*width+k];spline[i*width*3+width+k]=values[i*width+k];}
   const sampler={input:inputAccessor,output:append(spline,width===4?'VEC4':'VEC3'),interpolation:'CUBICSPLINE'},prior=clip.channels.find(c=>c.target.node===s.node&&c.target.path===s.path);
   if(prior)clip.samplers[prior.sampler]=sampler;else{clip.samplers.push(sampler);clip.channels.push({sampler:clip.samplers.length-1,target:{node:s.node,path:s.path}});}
  }
  const maxContactError=Math.max(...contacts.map(c=>c.error));
  if(maxContactError>.0003)throw Error(`Support source is not planted: ${maxContactError}`);
  reports.push({name,keys:times.length,changedTracks:streams.length,maxContactError,contacts});
  json.extras.characterMotion.clips=json.extras.characterMotion.clips.filter(c=>c.name!==name);
  json.extras.characterMotion.clips.push({name,contacts:contacts.length,keys:times.length,tracks:streams.length,cyclic:false,maxContactErrorNormalized:maxContactError/rig.chains[0].length});
 }
 json.buffers[0].byteLength=align4(binary.length);
 const report={revision:'20261017-moon-serpent-supported-actions-v2',sourceSha256,clips:reports};
 json.extras.coordinatedActionRepair={...report,clips:reports.map(({contacts,...r})=>({...r,contacts:contacts.length}))};
 json.extras.characterMotion.plantedAttack=true;json.extras.characterMotion.plantedRecoil=true;
 return {bytes:compactGlbDelivery(encodeStudioGlb(json,binary)),report};
}
