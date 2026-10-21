import {readFile,writeFile,mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {loadPetDeformationProbe} from '../scripts/lib/pet-deformation-probe.mjs';
import {parseStudioGlb,encodeStudioGlb,align4} from '../scripts/lib/pet-studio-glb.mjs';
import * as T from 'three';
const input='public/pet-models/roster/standard-1.glb',m=await loadPetDeformationProbe(input),o=await loadPetDeformationProbe('scripts/fixtures/pet-complete-face-20261015/standard-1-v1.glb');
assert.equal(m.sha256,'6576db9e525d89f513c1cffc86ee3cc1e8262a6fc0fb2401de6f891bc2303d23');
const mesh=m.meshes[0],a=mesh.geometry.attributes,oa=o.meshes[0].geometry.attributes;
assert.deepEqual(m.json.meshes[0].primitives[0].indices,o.json.meshes[0].primitives[0].indices);
assert.equal(a.position.count,oa.position.count);
const joints=new Uint8Array(a.position.count*4),weights=new Float32Array(a.position.count*4),changed=[];
const smooth=(lo,hi,x)=>{const t=Math.max(0,Math.min(1,(x-lo)/(hi-lo)));return t*t*(3-2*t);};
for(let v=0;v<a.position.count;v++){
 const p=mesh.getVertexPosition(v,new T.Vector3()).applyMatrix4(mesh.matrixWorld);
 let oldArm=0;for(let k=0;k<4;k++)if(/^(upper_arm|forearm|hand)[LR]$/.test(o.meshes[0].skeleton.bones[oa.skinIndex.getComponent(v,k)].name))oldArm+=oa.skinWeight.getComponent(v,k);
 const amount=smooth(.11,.145,Math.abs(p.x))*(1-smooth(.03,.065,p.y))*smooth(-.04,-.005,p.z)*(1-smooth(.155,.18,p.z))*smooth(.45,.7,oldArm);
 const values=new Map(),add=(j,w)=>values.set(j,(values.get(j)??0)+w);
 for(let k=0;k<4;k++){add(a.skinIndex.getComponent(v,k),a.skinWeight.getComponent(v,k)*(1-amount));add(oa.skinIndex.getComponent(v,k),oa.skinWeight.getComponent(v,k)*amount);}
 const ranked=[...values].filter(([,w])=>w>0).sort((a,b)=>b[1]-a[1]),floor=ranked[4]?.[1]??0,kept=ranked.slice(0,4).map(([j,w])=>[j,w-floor]),sum=kept.reduce((n,[,w])=>n+w,0);
 for(const[k,[j,w]]of kept.entries()){joints[4*v+k]=j;weights[4*v+k]=w/sum;}
 if(amount>0)changed.push(v);
}
const {json,bin}=parseStudioGlb(await readFile(input));let binary=bin;
function append(array,type,width,componentType){const b=Buffer.from(array.buffer,array.byteOffset,array.byteLength),offset=align4(binary.length);binary=Buffer.concat([binary,Buffer.alloc(offset-binary.length),b]);const bufferView=json.bufferViews.push({buffer:0,byteOffset:offset,byteLength:b.length})-1;return json.accessors.push({bufferView,componentType,count:array.length/width,type})-1;}
json.meshes[0].primitives[0].attributes.JOINTS_0=append(joints,'VEC4',4,5121);json.meshes[0].primitives[0].attributes.WEIGHTS_0=append(weights,'VEC4',4,5126);json.buffers[0].byteLength=align4(binary.length);
const folder='.tmp/rabbit-shoulder-ownership-v1';await mkdir(folder,{recursive:true});await writeFile(folder+'/source-candidate.glb',encodeStudioGlb(json,binary));
await writeFile(folder+'/diagnostic.json',JSON.stringify({inputSha256:m.sha256,originalSha256:o.sha256,changedVertices:changed.length,changed,geometryRigAnimationTextureChanged:false,publicAssetsChanged:false,visualApproval:false},null,2)+'\n');console.log({changedVertices:changed.length});
