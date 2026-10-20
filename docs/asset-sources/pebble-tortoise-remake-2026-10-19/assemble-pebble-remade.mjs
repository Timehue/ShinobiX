import {readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {loadPetDeformationProbe} from '../scripts/lib/pet-deformation-probe.mjs';
import {parseStudioGlb,encodeStudioGlb,align4} from '../scripts/lib/pet-studio-glb.mjs';
import {compactGlbDelivery} from '../scripts/compact-glb-delivery.mjs';
import sharp from 'sharp';
const dir='.tmp/pebble-full-remake',source=await readFile('public/pet-models/starter-earth.glb'),m=await loadPetDeformationProbe('public/pet-models/starter-earth.glb');
assert.equal(m.sha256,'c99b0471489b65a5fe2c4b9b50bf781c48f4820f7eacdb092cf983a15ca51894');
const d=JSON.parse(await readFile(dir+'/pebble-remade-mesh-private.json')),{json:j,bin}=parseStudioGlb(source);let binary=bin;
function append(data){const off=align4(binary.length);binary=Buffer.concat([binary,Buffer.alloc(off-binary.length),data]);return j.bufferViews.push({buffer:0,byteOffset:off,byteLength:data.length})-1;}
function add(arr,type,componentType=5126){const n={SCALAR:1,VEC2:2,VEC3:3,VEC4:4}[type],a={bufferView:append(Buffer.from(arr.buffer,arr.byteOffset,arr.byteLength)),componentType,count:arr.length/n,type};if(type==='VEC3'){a.min=[Infinity,Infinity,Infinity];a.max=[-Infinity,-Infinity,-Infinity];for(let i=0;i<arr.length;i++){const k=i%3;a.min[k]=Math.min(a.min[k],arr[i]);a.max[k]=Math.max(a.max[k],arr[i]);}}return j.accessors.push(a)-1;}
const bones=m.meshes[0].skeleton.bones,idx=name=>{const n=bones.findIndex(b=>b.name===name);assert(n>=0,name);return n;};
const smooth=(a,b,x)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);};
const volumeDistance=(p,volumes)=>Math.min(...volumes.map(([c,r])=>Math.sqrt(p.reduce((sum,v,k)=>sum+((v-c[k])/r[k])**2,0))));
const trunkVolumes=[[[0,-.005,.09],[.245,.29,.25]],[[0,-.38,.015],[.395,.43,.275]],[[0,-.62,.015],[.37,.22,.245]]];
const armVolumes=[[[.385,-.10,.08],[.17,.18,.17]],[[.50,-.245,.11],[.135,.23,.145]],[[.575,-.40,.17],[.14,.18,.15]],[[.60,-.52,.20],[.145,.14,.135]],...[0,1,2].map(k=>[[.52+k*.067,-.565,.265],[.045,.072,.065]])];
const legVolumes=[[[.275,-.68,.02],[.175,.23,.185]],[[.32,-.815,.075],[.15,.16,.16]],[[.33,-.925,.155],[.175,.075,.235]],...[0,1,2].map(k=>[[.33+(k-1)*.095,-.934,.33],[.055,.053,.08]])];
function skin(p,group){
 if(group==='head')return [[idx('head'),1]];
 if(group==='shell')return [[idx('spine'),1]];
 if(!['skin','torso'].includes(group))return [[idx(group),1]];
 const [x,y,z]=p,weights=new Map(),put=(name,w)=>{if(w>1e-7)weights.set(idx(name),(weights.get(idx(name))??0)+w);};
 const head=Math.max(smooth(-.08,.13,y),smooth(-.22,-.13,y)*smooth(.28,.37,z));
 if(head>.9999)return [[idx('head'),1]];
 let rest=1-head;put('head',head);
 if(group==='skin'){
 // Use the actual sculpt masses to separate nearby palms and thighs. A
 // rectangular coordinate mask can pull fingers toward legs or vice versa.
 const mirrored=[Math.abs(x),y,z],qa=volumeDistance(mirrored,armVolumes),ql=volumeDistance(mirrored,legVolumes),qt=volumeDistance(mirrored,trunkVolumes);
 const arm=smooth(-.14,.14,Math.min(ql,qt)-qa);
 const leg=smooth(-.14,.14,qt-ql);
 if(arm>0){const a=arm*rest,side=x>0?'L':'R',hand=1-smooth(-.48,-.43,y),fore=(1-smooth(-.32,-.20,y))*(1-hand);put('hand'+side,a*hand);put('forearm'+side,a*fore);put('upper_arm'+side,a*(1-hand-fore));rest*=1-arm;}
 if(leg>0){const a=leg*rest,side=x>0?'L':'R',foot=1-smooth(-.935,-.875,y),shin=(1-smooth(-.82,-.72,y))*(1-foot);put('foot'+side,a*foot);put('shin'+side,a*shin);put('thigh'+side,a*(1-foot-shin));rest*=1-leg;}
 }
 const upper=smooth(-.4,.03,y),lower=1-smooth(-.58,-.29,y);put('chest',rest*upper);put('pelvis',rest*lower*(1-upper));put('spine',rest*(1-upper)*(1-lower));
 return [...weights].sort((a,b)=>b[1]-a[1]).slice(0,4);
}
const joints=[],weights=[];for(let i=0;i<d.groups.length;i++){const w=skin(d.positions.slice(i*3,i*3+3),d.groups[i]),sum=w.reduce((a,b)=>a+b[1],0);assert(sum>.99);for(let k=0;k<4;k++){joints.push(w[k]?.[0]??0);weights.push((w[k]?.[1]??0)/sum);}}
const attributes={POSITION:add(new Float32Array(d.positions),'VEC3'),NORMAL:add(new Float32Array(d.normals),'VEC3'),TEXCOORD_0:add(new Float32Array(d.uvs),'VEC2'),JOINTS_0:add(new Uint16Array(joints),'VEC4',5123),WEIGHTS_0:add(new Float32Array(weights),'VEC4')};
j.meshes[0].primitives=[{attributes,indices:add(new Uint32Array(d.indices),'SCALAR',5125),material:0,mode:4}];j.meshes[0].name='Pebble complete remade sculpt PRIVATE';
const atlas=await sharp(dir+'/pebble-remade-atlas-private.png').webp({lossless:true,effort:6}).toBuffer();await writeFile(dir+'/pebble-remade-atlas-private.webp',atlas);
j.images=[{name:'Pebble sculpt authored atlas',bufferView:append(atlas),mimeType:'image/webp'}];j.textures=[{extensions:{EXT_texture_webp:{source:0}},sampler:0}];j.samplers=[{magFilter:9729,minFilter:9987,wrapS:10497,wrapT:10497}];
j.materials=[{name:'Pebble authored skin cloth and pebble atlas',pbrMetallicRoughness:{baseColorTexture:{index:0},metallicFactor:0,roughnessFactor:.75}}];
const retainedAnimationMetadata=Object.fromEntries(['properAnimationBank','properAnimationFamily','properAnimationRig','properAnimationSignature','animationAuthoring','properAnimationIdentity'].map(k=>[k,j.extras[k]]));
const bank=j.extras.characterMotion;
j.extras={...retainedAnimationMetadata,characterMotion:{revision:bank.revision,family:bank.family,supportChains:bank.supportChains,clips:bank.clips.map(({name,contacts})=>({name,contacts})),plantedAttack:bank.plantedAttack,plantedRecoil:bank.plantedRecoil,retainedRigCurvesFromSha256:m.sha256,visibleSurfaceContacts:'Fresh private production validation required'},pebbleFullRemake:{revision:'20261019-full-sculpt-private-v1',privateCandidateOnly:true,acceptance:'unreviewed',rejectedPredecessorSha256:m.sha256,construction:d.construction,geometryEntirelyNew:true,uvAtlasEntirelyNew:true,animations:'Retained 13-clip rig; fresh deformation and contact validation required'}};
j.buffers[0].byteLength=binary.length;await writeFile(dir+'/pebble-remade-private.glb',compactGlbDelivery(encodeStudioGlb(j,binary)));
const after=await loadPetDeformationProbe(dir+'/pebble-remade-private.glb');assert.deepEqual(after.animations.map(c=>c.name),m.animations.map(c=>c.name));
await writeFile(dir+'/private-assembly.json',JSON.stringify({sha256:after.sha256,vertices:d.groups.length,triangles:d.indices.length/3,animations:after.animations.map(c=>c.name),privateCandidateOnly:true,acceptance:'unreviewed'},null,2));console.log({sha256:after.sha256,vertices:d.groups.length,triangles:d.indices.length/3});
