// Private calibration of the new visible foot surface, preserving all authored
// rotations/scales, and analytically preserving horizontal root trajectories.
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import * as T from 'three';
import {parseStudioGlb,encodeStudioGlb,align4,readStudioAccessor} from '../scripts/lib/pet-studio-glb.mjs';
import {loadPetDeformationProbe,snapshotPetPose} from '../scripts/lib/pet-deformation-probe.mjs';
import {stablePetModelPresentationBounds} from '../src/lib/pet-model-bounds.ts';
const dir='.tmp/pebble-full-remake',path=dir+'/pebble-remade-before-ground.glb',destination=dir+'/pebble-remade-private.glb',bytes=await readFile(path),hash=b=>createHash('sha256').update(b).digest('hex');
assert.equal(hash(bytes),'d2052ba00628709f23b67c1d5b474a103ee8120d8dfbe4c0730fc90deaafa8f8');
const {json,bin}=parseStudioGlb(bytes),model=await loadPetDeformationProbe(path),restore=snapshotPetPose(model.scene),mixer=new T.AnimationMixer(model.scene),mesh=model.meshes[0],rootId=json.nodes.findIndex(n=>n.name==='root');let binary=bin;
function minimum(){let y=Infinity;const p=new T.Vector3();for(let v=0;v<mesh.geometry.attributes.position.count;v++)y=Math.min(y,mesh.getVertexPosition(v,p).applyMatrix4(mesh.matrixWorld).y);return y;}
const battle=await loadPetDeformationProbe(dir+'/delivery/public/pet-models/warfront-lod/starter-earth.glb');
const presentationGround={source:stablePetModelPresentationBounds(model.scene).groundY,battle:stablePetModelPresentationBounds(battle.scene).groundY};
const ground=Math.max(presentationGround.source,presentationGround.battle),padding=.0015,reports=[];
function add(values,width){const off=align4(binary.length),raw=Buffer.from(values.buffer,values.byteOffset,values.byteLength);binary=Buffer.concat([binary,Buffer.alloc(off-binary.length),raw]);const view=json.bufferViews.push({buffer:0,byteOffset:off,byteLength:raw.length})-1;return json.accessors.push({bufferView:view,componentType:5126,count:values.length/width,type:width===1?'SCALAR':'VEC3'})-1;}
function curve(times,values,t){let i=0;while(i<times.length-2&&times[i+1]<t)i++;const h=times[i+1]-times[i],u=Math.max(0,Math.min(1,(t-times[i])/h)),v=[],d=[];for(let k=0;k<3;k++){const a=values[i*9+3+k],ta=values[i*9+6+k],z=values[(i+1)*9+3+k],tz=values[(i+1)*9+k];v.push((2*u**3-3*u*u+1)*a+(u**3-2*u*u+u)*h*ta+(-2*u**3+3*u*u)*z+(u**3-u*u)*h*tz);d.push((6*u*u-6*u)/h*a+(3*u*u-4*u+1)*ta+(-6*u*u+6*u)/h*z+(3*u*u-2*u)*tz);}return{v,d};}
for(const clip of json.animations){
 const take=model.animations.find(c=>c.name===clip.name),channel=clip.channels.find(c=>c.target.node===rootId&&c.target.path==='translation'),sampler=channel?clip.samplers[channel.sampler]:null;
 if(sampler)assert.equal(sampler.interpolation,'CUBICSPLINE');
 const input=sampler?await readStudioAccessor(json,bin,sampler.input):{values:Float32Array.from([0,take.duration])},output=sampler?await readStudioAccessor(json,bin,sampler.output):{values:Float32Array.from([0,0,0,...json.nodes[rootId].translation,0,0,0,0,0,0,...json.nodes[rootId].translation,0,0,0])};
 const steps=Math.ceil(take.duration*240),times=Float32Array.from([...new Set([...input.values,...Array.from({length:steps+1},(_,i)=>Math.fround(take.duration*i/steps))])].sort((a,b)=>a-b)),lifts=[],samples=[];
 for(const t of times){mixer.stopAllAction();restore();const a=mixer.clipAction(take).reset().setLoop(T.LoopOnce,1);a.clampWhenFinished=true;a.play();a.time=t;mixer.update(0);model.update();const min=minimum(),lift=Math.max(0,ground+padding-min);lifts.push(lift);samples.push({time:t,minY:min,lift});}
 const slopes=times.map((_,i)=>{if(i===0||i===times.length-1||lifts[i]===0)return 0;const left=(lifts[i]-lifts[i-1])/(times[i]-times[i-1]),right=(lifts[i+1]-lifts[i])/(times[i+1]-times[i]);return left*right>0?2*left*right/(left+right):0;}),values=new Float32Array(times.length*9);
 for(let i=0;i<times.length;i++){const old=curve(input.values,output.values,times[i]);for(let k=0;k<3;k++){values[i*9+k]=values[i*9+6+k]=old.d[k]+(k===1?slopes[i]:0);values[i*9+3+k]=old.v[k]+(k===1?lifts[i]:0);}}
 const ni=add(times,1);json.accessors[ni].min=[times[0]];json.accessors[ni].max=[times.at(-1)];const ns={input:ni,output:add(values,3),interpolation:'CUBICSPLINE'};
 if(sampler)Object.assign(sampler,ns);else clip.channels.push({sampler:clip.samplers.push(ns)-1,target:{node:rootId,path:'translation'}});
 reports.push({clip:clip.name,keys:times.length,maximumLift:Math.max(...lifts),minimumBefore:Math.min(...samples.map(s=>s.minY)),ground,padding});console.log(reports.at(-1));
}
json.buffers[0].byteLength=binary.length;json.extras.pebbleFullRemake.groundCalibration={sourceSha256:hash(bytes),sampleHz:240,presentationGround,scope:'Measured visible-surface vertical root correction using production percentile ground; all original rotations/scales and horizontal root paths preserved',reports,productionApproval:false};
await writeFile(destination,encodeStudioGlb(json,binary));
await writeFile(dir+'/private-ground-calibration.json',JSON.stringify({sourceSha256:hash(bytes),sha256:hash(await readFile(destination)),presentationGround,reports,acceptance:'Private candidate; offset-grid and production contact verification pending'},null,2));
