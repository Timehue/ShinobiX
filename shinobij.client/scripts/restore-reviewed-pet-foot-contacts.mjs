// Candidate-only correction after orthogonal rig retargeting. Preserve current
// horizontal gait and restore the original authored vertical foot trajectories.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {Vector3,Quaternion,Matrix4} from 'three';
import {MeshoptEncoder} from 'meshoptimizer';
import {parseStudioGlb,encodeStudioGlb,align4} from './lib/pet-studio-glb.mjs';
import {createCharacterRig,readCharacterTake,sampleChannel,solveFoot} from './lib/pet-character-motion.mjs';
import {studioTangents} from './lib/pet-studio-curves.mjs';
import {compactGlbDelivery} from './compact-glb-delivery.mjs';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const pose=(rig,take,p)=>{rig.reset();for(const c of take.channels){const node=rig.nodes[c.node],v=sampleChannel(c,p);if(c.path==='rotation')node.quaternion.fromArray(v);else if(c.path==='translation')node.position.fromArray(v);else if(c.path==='scale')node.scale.fromArray(v);}rig.scene.updateMatrixWorld(true);};
const position=(node,frame)=>node.getWorldPosition(new Vector3()).applyMatrix4(new Matrix4().copy(frame.matrixWorld).invert());
const rotation=(node,frame)=>{const q=new Quaternion();new Matrix4().copy(frame.matrixWorld).invert().multiply(node.matrixWorld).decompose(new Vector3(),q,new Vector3());return q;};
export async function restoreReviewedPetFootContacts(source,reference,destination){
 assert.notEqual(resolve(source),resolve(destination));
 const before=await readFile(source),raw=await readFile(reference),{json,bin}=parseStudioGlb(before),old=parseStudioGlb(raw);
 assert.ok(json.extras.reviewedRigScaleRepair);assert.ok(!json.extras.reviewedFootContactRepair);
 const rig=createCharacterRig(json),original=createCharacterRig(old.json),rootId=rig.byName.get('root');
 assert.ok(rig.chains.length);assert.ok(rootId!==undefined);const root=rig.nodes[rootId];
 for(const chain of rig.chains)assert.equal(chain.frame,root.parent);
 await MeshoptEncoder.ready;let binary=bin;
 let fallback=json.buffers.findIndex(b=>b.extensions?.EXT_meshopt_compression?.fallback);
 if(fallback<0){fallback=json.buffers.length;json.buffers.push({byteLength:0,extensions:{EXT_meshopt_compression:{fallback:true}}});}
 const append=(values,width)=>{
  const data=Buffer.from(values.buffer,values.byteOffset,values.byteLength),stride=width*4,packed=MeshoptEncoder.encodeGltfBuffer(data,values.length/width,stride,'ATTRIBUTES'),offset=align4(binary.length),virtual=align4(json.buffers[fallback].byteLength);
  binary=Buffer.concat([binary,Buffer.alloc(offset-binary.length),packed]);json.buffers[fallback].byteLength=virtual+data.length;
  const bufferView=json.bufferViews.push({buffer:fallback,byteOffset:virtual,byteLength:data.length,byteStride:stride,extensions:{EXT_meshopt_compression:{buffer:0,byteOffset:offset,byteLength:packed.length,byteStride:stride,count:values.length/width,mode:'ATTRIBUTES'}}})-1;
  return json.accessors.push({bufferView,componentType:5126,count:values.length/width,type:width===1?'SCALAR':width===3?'VEC3':'VEC4'})-1;
 };
 const clips=[];
 for(const clip of json.animations.filter(c=>['idle','walk','gallop','guard','rest'].includes(c.name))){
  const take=await readCharacterTake(json,bin,clip),oldTake=await readCharacterTake(old.json,old.bin,old.json.animations.find(c=>c.name===clip.name));
  const intervals=Math.max(32,Math.ceil(take.duration*48)),times=Float32Array.from({length:intervals+1},(_,i)=>take.duration*i/intervals);
  const tracks=new Map();for(const chain of rig.chains)for(const node of chain.ids)tracks.set(`${node}:rotation`,{node,path:'rotation',values:[]});
  tracks.set(`${rootId}:translation`,{node:rootId,path:'translation',values:[]});let maxError=0;
  for(let i=0;i<times.length;i++){
   const p=i/intervals;pose(rig,take,p);pose(original,oldTake,p);
   const targets=rig.chains.map(chain=>{
    const foot=rig.nodes[chain.ids[2]],point=foot.getWorldPosition(new Vector3()),oldFoot=original.nodes[original.byName.get(foot.name)];assert.ok(oldFoot);
    point.y=oldFoot.getWorldPosition(new Vector3()).y;
    return {chain,target:point.applyMatrix4(new Matrix4().copy(chain.frame.matrixWorld).invert()),orientation:rotation(foot,chain.frame)};
   });
   // Lower only when necessary to keep every target within the rigid leg reach.
   let low=-Infinity,high=Infinity;
   for(const {chain,target}of targets){const hip=position(rig.nodes[chain.ids[0]],chain.frame),delta=target.clone().sub(hip),height=delta.dot(chain.up),horizontal=Math.max(0,delta.lengthSq()-height*height),vertical=Math.sqrt(Math.max(0,(chain.length*.994)**2-horizontal));low=Math.max(low,height-vertical);high=Math.min(high,height+vertical);}
   assert.ok(low<=high,`${clip.name}@${p}: no shared support height`);
   root.position.addScaledVector(rig.chains[0].up,Math.max(low,Math.min(high,0)));
   for(const {chain,target,orientation}of targets)maxError=Math.max(maxError,solveFoot(rig,chain,target,orientation)/chain.length);
   for(const track of tracks.values())track.values.push(...(track.path==='rotation'?rig.nodes[track.node].quaternion.toArray():rig.nodes[track.node].position.toArray()));
  }
  assert.ok(maxError<.0001,`${clip.name}: unreachable support ${maxError}`);
  const input=append(times,1);json.accessors[input].min=[0];json.accessors[input].max=[take.duration];
  for(const track of tracks.values()){
   const width=track.path==='rotation'?4:3,values=Float32Array.from(track.values);
   if(width===4)for(let i=1;i<times.length;i++){let dot=0;for(let k=0;k<4;k++)dot+=values[(i-1)*4+k]*values[i*4+k];if(dot<0)for(let k=0;k<4;k++)values[i*4+k]*=-1;}
   for(let k=0;k<width;k++)values[(times.length-1)*width+k]=values[k];
   const tangent=studioTangents(times,values,width,true),spline=new Float32Array(times.length*width*3);
   for(let i=0;i<times.length;i++)for(let k=0;k<width;k++){spline[i*width*3+k]=spline[i*width*3+width*2+k]=tangent[i*width+k];spline[i*width*3+width+k]=values[i*width+k];}
   const sampler={input,output:append(spline,width),interpolation:'CUBICSPLINE'},channel=clip.channels.find(c=>c.target.node===track.node&&c.target.path===track.path);
   assert.ok(channel,`${clip.name}: support track must already exist`);clip.samplers[channel.sampler]=sampler;
  }
  clips.push({name:clip.name,keys:times.length,tracks:tracks.size,maxContactErrorNormalized:maxError});
 }
 json.extras.reviewedFootContactRepair={revision:'20261015-orthogonal-contact-v1',sourceSha256:sha(before),referenceSha256:sha(raw),clips};json.buffers[0].byteLength=align4(binary.length);
 const packed=parseStudioGlb(compactGlbDelivery(encodeStudioGlb(json,binary)));
 packed.json.extras.properAnimationSourceBoundary={binLength:packed.bin.length,accessorCount:packed.json.accessors.length,bufferViewCount:packed.json.bufferViews.length};
 const output=encodeStudioGlb(packed.json,packed.bin);await mkdir(dirname(destination),{recursive:true});await writeFile(destination,output);
 return {sourceSha256:sha(before),sha256:sha(output),clips};
}
if(process.argv[1]&&resolve(process.argv[1])===resolve(import.meta.filename))console.log(JSON.stringify(await restoreReviewedPetFootContacts(...process.argv.slice(2).map(p=>resolve(p))),null,2));
