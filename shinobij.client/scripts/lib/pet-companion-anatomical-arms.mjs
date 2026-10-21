import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import * as T from 'three';
import {loadPetDeformationProbeBytes} from './pet-deformation-probe.mjs';
import {parseStudioGlb,encodeStudioGlb,align4} from './pet-studio-glb.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
// Root's anatomical placement from native bind views, not the old influence centroids.
const configs={
 'standard-2':{sha:'098db66d1e18ad7847f947e4f5b9d845a6c7d27ff5624693eb9779874b8383cb',center:-.002,points:[[.155,.025,.075],[.222,-.10,.10],[.275,-.18,.135]],top:[-.035,.025],back:[.005,.035],front:[.23,.26],elbow:[-.13,-.075],hand:[-.19,-.155],threshold:.11,slope:.61},
 'standard-15':{sha:'23316bf5bdce50b822921969bd3e7c92bbb1e59ad3a0cb5ad68e68ee8ed5f3f5',center:.083,points:[[.16,.01,.105],[.20,-.10,.12],[.235,-.18,.155]],top:[-.07,.015],back:[.025,.065],front:[.235,.26],elbow:[-.14,-.075],hand:[-.20,-.16],threshold:.14,slope:.25},
 'rare-21':{sha:'833233bcbdb05dd65f1748cbcf1168b54b05078ee4dae47da9e2a10709289441',center:.052,points:[[.15,-.015,.15],[.175,-.10,.16],[.21,-.18,.195]],top:[-.075,-.005],back:[.07,.105],front:[.285,.31],elbow:[-.14,-.075],hand:[-.20,-.155],threshold:.09,slope:.28},
};
export async function repairCompanionArmRig(bytes,id){
 const c=configs[id];assert.ok(c,'No measured arm recipe for '+id);assert.equal(sha(bytes),c.sha,'Unexpected fitted-arm source');
 const model=await loadPetDeformationProbeBytes(bytes),mesh=model.meshes[0],{json,bin}=parseStudioGlb(bytes),skin=json.skins[0];
 const before=Array.from({length:mesh.geometry.attributes.position.count},(_,v)=>mesh.getVertexPosition(v,new T.Vector3()).applyMatrix4(mesh.matrixWorld));
 const correction=mesh.skeleton.bones[0].matrixWorld.clone().multiply(mesh.skeleton.boneInverses[0]);
 for(const [side,sign]of[['L',1],['R',-1]])for(const[k,part]of['upper_arm','forearm','hand'].entries()){
  const i=mesh.skeleton.bones.findIndex(b=>b.name===part+side);assert.ok(i>=0);const bone=mesh.skeleton.bones[i],target=new T.Vector3(...c.points[k]);target.x=target.x*sign+c.center;
  const local=bone.parent.worldToLocal(target);bone.position.copy(local);model.update();json.nodes[skin.joints[i]].translation=local.toArray();
  mesh.skeleton.boneInverses[i].copy(bone.matrixWorld).invert().multiply(correction);
 }
 const a=mesh.geometry.attributes,lowerArm=new Set(),cut=id==='standard-15'?-.13:id==='rare-21'?-.08:-.045;
 const positionGroups=new Map(),groupByVertex=[];
 before.forEach((p,v)=>{const key=p.toArray().map(n=>Math.round(n*1e5)).join(',');if(!positionGroups.has(key))positionGroups.set(key,[]);const group=positionGroups.get(key);group.push(v);groupByVertex[v]=group;});
 const adjacent=Array.from({length:before.length},()=>new Set()),idx=mesh.geometry.index;
 for(let t=0;t<idx.count;t+=3){const tri=[0,1,2].map(k=>idx.getX(t+k));for(const v of tri)for(const n of tri)if(v!==n)adjacent[v].add(n);}
 for(const sign of[1,-1]){const target=new T.Vector3(c.center+sign*c.points[2][0],-.22,c.points[2][2]);let seed=-1,d=Infinity;before.forEach((p,v)=>{if(p.y>=cut)return;const q=p.distanceToSquared(target);if(q<d){d=q;seed=v;}});assert.ok(seed>=0);const queue=[seed],seen=new Set([seed]);for(let qi=0;qi<queue.length;qi++){const v=queue[qi];lowerArm.add(v);for(const n of[...adjacent[v],...groupByVertex[v]])if(!seen.has(n)&&before[n].y<cut){seen.add(n);queue.push(n);}}assert.ok(seen.size>100&&seen.size<before.length/4);}
 const armIds=new Set(mesh.skeleton.bones.map((b,i)=>/^(upper_arm|forearm|hand)[LR]$/.test(b.name)?i:-1).filter(i=>i>=0)),chest=mesh.skeleton.bones.findIndex(b=>b.name==='chest');
 const smooth=(lo,hi,x)=>{const t=Math.max(0,Math.min(1,(x-lo)/(hi-lo)));return t*t*(3-2*t);};
 const joints=new Uint16Array(a.position.count*4),weights=new Float32Array(a.position.count*4);
 for(let v=0;v<a.position.count;v++){
  const p=before[v],boundary=c.threshold+c.slope*(-.04-p.y),field=smooth(boundary-(id==='standard-15'?.05:.012),boundary+(id==='standard-15'?.05:.012),Math.abs(p.x-c.center))*(1-smooth(...c.top,p.y))*smooth(-.33,-.29,p.y)*smooth(...c.back,p.z)*(1-smooth(...c.front,p.z)),lowerBlend=1-smooth(cut-(id==='standard-15'?.07:.035),cut,p.y),amount=field*(1-lowerBlend)+(lowerArm.has(v)?lowerBlend:0);
  const values=new Map(),add=(j,w)=>values.set(j,(values.get(j)??0)+w);
  for(let k=0;k<4;k++){const j=a.skinIndex.getComponent(v,k),w=a.skinWeight.getComponent(v,k)*(1-amount);add(armIds.has(j)?chest:j,w);}
  const side=p.x>=c.center?'L':'R',ids=['upper_arm','forearm','hand'].map(n=>mesh.skeleton.bones.findIndex(b=>b.name===n+side)),lower=1-smooth(...c.elbow,p.y),hand=1-smooth(...c.hand,p.y);
  add(ids[0],amount*(1-lower));add(ids[1],amount*lower*(1-hand));add(ids[2],amount*lower*hand);
  const ordered=[...values].filter(([,w])=>w>0).sort((a,b)=>b[1]-a[1]),floor=ordered[4]?.[1]??0,kept=ordered.slice(0,4).map(([j,w])=>[j,w-floor]),sum=kept.reduce((n,[,w])=>n+w,0);assert.ok(sum>0);
  kept.forEach(([j,w],k)=>{joints[4*v+k]=j;weights[4*v+k]=w/sum*[0,1,2,3].reduce((n,k)=>n+a.skinWeight.getComponent(v,k),0);});
 }
 const ibm=Float32Array.from(mesh.skeleton.boneInverses.flatMap(m=>m.toArray())),data=Buffer.from(ibm.buffer),offset=align4(bin.length),binary=Buffer.concat([bin,Buffer.alloc(offset-bin.length),data]);
 const view=json.bufferViews.push({buffer:0,byteOffset:offset,byteLength:data.length})-1;
 skin.inverseBindMatrices=json.accessors.push({bufferView:view,componentType:5126,type:'MAT4',count:ibm.length/16})-1;json.buffers[0].byteLength=align4(binary.length);
 let finalBin=binary;
 for(const [name,array,type]of[['JOINTS_0',joints,5123],['WEIGHTS_0',weights,5126]]){const b=Buffer.from(array.buffer),o=align4(finalBin.length);finalBin=Buffer.concat([finalBin,Buffer.alloc(o-finalBin.length),b]);const vi=json.bufferViews.push({buffer:0,byteOffset:o,byteLength:b.length})-1;json.meshes[0].primitives[0].attributes[name]=json.accessors.push({bufferView:vi,componentType:type,type:'VEC4',count:array.length/4})-1;}
 json.buffers[0].byteLength=align4(finalBin.length);
 json.extras={...json.extras,anatomicalArmFrameRepair:{revision:'20261021-companion-anatomical-arms-v1',id,inputSha256:c.sha,points:c.points,scope:'Six anatomically fitted arm rest frames, inverse binds, and connected arm weighting; sculpt, textures and authored animation streams preserved',visualApproval:false}};
 const output=encodeStudioGlb(json,finalBin),check=await loadPetDeformationProbeBytes(output);let maxBindError=0;
 before.forEach((p,v)=>maxBindError=Math.max(maxBindError,p.distanceTo(check.meshes[0].getVertexPosition(v,new T.Vector3()).applyMatrix4(check.meshes[0].matrixWorld))));assert.ok(maxBindError<.000002,`${id} bind error ${maxBindError}`);
 for(const m of[model,check])for(const surface of m.meshes)surface.geometry.dispose();
 return{bytes:output,report:{id,inputSha256:c.sha,outputSha256:sha(output),maximumBindDrift:maxBindError,fittedFrames:6,connectedLowerArmVertices:lowerArm.size,visualApproval:false}};
}
