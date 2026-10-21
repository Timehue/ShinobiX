import sharp from 'sharp';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import * as T from 'three';
import {loadPetDeformationProbeBytes} from './pet-deformation-probe.mjs';
import {parseStudioGlb,encodeStudioGlb,align4} from './pet-studio-glb.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
// Root's anatomical placement from native bind views, not the old influence centroids.
const id='standard-3',c={sha:'3f95067b53342568b4dd24d334da9e5e6520f848199cccb62c56935210b8f55f',points:[[0,.16,.20],[0,.265,.21]]};
async function fitFrames(bytes){assert.equal(sha(bytes),c.sha);
 const model=await loadPetDeformationProbeBytes(bytes),mesh=model.meshes[0],{json,bin}=parseStudioGlb(bytes),skin=json.skins[0];
 const before=Array.from({length:mesh.geometry.attributes.position.count},(_,v)=>mesh.getVertexPosition(v,new T.Vector3()).applyMatrix4(mesh.matrixWorld));
 const corrections=mesh.skeleton.bones.map((bone,i)=>bone.matrixWorld.clone().multiply(mesh.skeleton.boneInverses[i]));
 for(const[k,name]of['neck','head'].entries()){
 const i=mesh.skeleton.bones.findIndex(b=>b.name===name),bone=mesh.skeleton.bones[i],target=new T.Vector3(...c.points[k]);assert.ok(i>=0);const local=bone.parent.worldToLocal(target);bone.position.copy(local);model.update();json.nodes[skin.joints[i]].translation=local.toArray();mesh.skeleton.boneInverses[i].copy(bone.matrixWorld).invert().multiply(corrections[i]);
 }
 const ibm=Float32Array.from(mesh.skeleton.boneInverses.flatMap(m=>m.toArray())),data=Buffer.from(ibm.buffer),offset=align4(bin.length),binary=Buffer.concat([bin,Buffer.alloc(offset-bin.length),data]);
 const view=json.bufferViews.push({buffer:0,byteOffset:offset,byteLength:data.length})-1;
 skin.inverseBindMatrices=json.accessors.push({bufferView:view,componentType:5126,type:'MAT4',count:ibm.length/16})-1;json.buffers[0].byteLength=align4(binary.length);
 json.extras={...json.extras,anatomicalNeckFrameRepair:{revision:'20261021-forest-neck-frames-v1',id,inputSha256:c.sha,points:c.points,scope:'Two neck and head rest frames and inverse binds only; sculpt, textures, palettes and authored animation streams preserved',visualApproval:false}};
 const output=encodeStudioGlb(json,binary),check=await loadPetDeformationProbeBytes(output);let maxBindError=0;
 before.forEach((p,v)=>maxBindError=Math.max(maxBindError,p.distanceTo(check.meshes[0].getVertexPosition(v,new T.Vector3()).applyMatrix4(check.meshes[0].matrixWorld))));assert.ok(maxBindError<.000001);
 return output;
}

export async function repairForestNeckCloth(input){
const fitted=await fitFrames(input),m=await loadPetDeformationProbeBytes(fitted),mesh=m.meshes[0],a=mesh.geometry.attributes,{json,bin}=parseStudioGlb(fitted),neck=mesh.skeleton.bones.findIndex(b=>b.name==='neck');
const mat=json.materials[json.meshes[0].primitives[0].material],tx=json.textures[mat.pbrMetallicRoughness.baseColorTexture.index],im=json.images[tx.source??tx.extensions.EXT_texture_webp.source],bv=json.bufferViews[im.bufferView],{data,info}=await sharp(bin.subarray(bv.byteOffset??0,(bv.byteOffset??0)+bv.byteLength)).removeAlpha().raw().toBuffer({resolveWithObject:true});
const points=Array.from({length:a.position.count},(_,v)=>mesh.getVertexPosition(v,new T.Vector3()).applyMatrix4(mesh.matrixWorld)),seeds=[];
for(let v=0;v<a.position.count;v++){const p=points[v],u=a.uv.getX(v),w=a.uv.getY(v),k=(Math.min(info.height-1,Math.max(0,Math.floor(w*info.height)))*info.width+Math.min(info.width-1,Math.max(0,Math.floor(u*info.width))))*3,c=[...data.subarray(k,k+3)];if(p.y>-.075&&p.y<.20&&p.z>.1&&Math.abs(p.x)<.25&&Math.max(...c)<100&&Math.max(...c)-Math.min(...c)<22&&c[2]>=c[0]*.9&&c[1]>=c[0]*.95)seeds.push(v);}
const joints=new Uint16Array(a.position.count*4),weights=new Float32Array(a.position.count*4),smooth=x=>{const t=Math.max(0,Math.min(1,x));return t*t*(3-2*t);};let changed=0,rigid=0;
for(let v=0;v<a.position.count;v++){const p=points[v];let distance=Infinity;if(p.y>-.12&&p.y<.29&&p.z>.05&&Math.abs(p.x)<.3)for(const i of seeds)distance=Math.min(distance,p.distanceToSquared(points[i]));const headShare=[0,1,2,3].reduce((n,k)=>n+(mesh.skeleton.bones[a.skinIndex.getComponent(v,k)].name==='head'?a.skinWeight.getComponent(v,k):0),0);const amount=(1-smooth((headShare-.4)/.6))*(1-smooth((Math.abs(p.x)-.20)/.06))*(1-smooth((Math.sqrt(distance)-.003)/.035))*(1-smooth((p.y-.18)/.045)),values=new Map(),sum=[0,1,2,3].reduce((s,k)=>s+a.skinWeight.getComponent(v,k),0);for(let k=0;k<4;k++){const j=a.skinIndex.getComponent(v,k),w=a.skinWeight.getComponent(v,k);values.set(j,(values.get(j)??0)+w*(1-amount));}values.set(neck,(values.get(neck)??0)+sum*amount);const rows=[...values].filter(([,w])=>w>0).sort((a,b)=>b[1]-a[1]),floor=rows[4]?.[1]??0,kept=rows.slice(0,4).map(([j,w])=>[j,w-floor]),total=kept.reduce((n,[,w])=>n+w,0);kept.forEach(([j,w],k)=>{joints[4*v+k]=j;weights[4*v+k]=w/total*sum;});if(amount>0)changed++;if(amount===1)rigid++;}
let binary=bin;for(const[name,array,type]of[['JOINTS_0',joints,5123],['WEIGHTS_0',weights,5126]]){const bytes=Buffer.from(array.buffer),off=align4(binary.length);binary=Buffer.concat([binary,Buffer.alloc(off-binary.length),bytes]);const vi=json.bufferViews.push({buffer:0,byteOffset:off,byteLength:bytes.length})-1;json.meshes[0].primitives[0].attributes[name]=json.accessors.push({bufferView:vi,componentType:type,type:'VEC4',count:array.length/4})-1;}json.buffers[0].byteLength=align4(binary.length);json.extras.clothNeckTrial={seeds:seeds.length,changed,rigid,visualApproval:false};const output=encodeStudioGlb(json,binary);return {bytes:output,report:{id,inputSha256:sha(input),outputSha256:sha(output),frameCount:2,...json.extras.clothNeckTrial}};
}
