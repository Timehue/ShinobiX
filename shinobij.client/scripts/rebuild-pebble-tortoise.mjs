import {readFile,writeFile,mkdir,rm} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import{createHash}from'node:crypto';
import assert from'node:assert/strict';
import{normalizeReviewedPetRigScale}from'./normalize-reviewed-pet-rig-scale.mjs';
import{compactGlbDelivery}from'./compact-glb-delivery.mjs';
import * as T from 'three';
import sharp from 'sharp';
import {loadPetDeformationProbe} from './lib/pet-deformation-probe.mjs';
import {parseStudioGlb,encodeStudioGlb,align4,readStudioAccessor} from './lib/pet-studio-glb.mjs';
export async function rebuildPebbleTortoise(original,destination){
assert.notEqual(resolve(original),resolve(destination));
const originalBytes=await readFile(original),originalSha=createHash('sha256').update(originalBytes).digest('hex');
assert.equal(originalSha,'0a1706f3bfbe4399202530b788c5b1573ceecaf6a345fa38296e389f4c5feae5','Use the pinned original Pebble asset');
await mkdir(dirname(destination),{recursive:true});const source=destination+'.orthogonal.glb';
await normalizeReviewedPetRigScale(original,source);
const bytes=await readFile(source),m=await loadPetDeformationProbe(source),s=m.meshes[0],g=s.geometry,{json:j,bin}=parseStudioGlb(bytes),bones=s.skeleton.bones;
let binary=bin;
const add=(arr,type,componentType=5126)=>{const n={SCALAR:1,VEC2:2,VEC3:3,VEC4:4,MAT4:16}[type],off=align4(binary.length),data=Buffer.from(arr.buffer,arr.byteOffset,arr.byteLength);binary=Buffer.concat([binary,Buffer.alloc(off-binary.length),data]);const view=j.bufferViews.push({buffer:0,byteOffset:off,byteLength:data.length})-1;const a={bufferView:view,componentType,count:arr.length/n,type};if(type==='VEC3'){a.min=Array.from({length:3},(_,k)=>{let min=Infinity;for(let i=k;i<arr.length;i+=3)min=Math.min(min,arr[i]);return min;});a.max=Array.from({length:3},(_,k)=>{let max=-Infinity;for(let i=k;i<arr.length;i+=3)max=Math.max(max,arr[i]);return max;});}return j.accessors.push(a)-1;};
// Move the generic joints to Pebble's visible joints. The mesh stays in place.
const locations={};for(const [side,sign] of [['L',1],['R',-1]])Object.assign(locations,{['upper_arm'+side]:[sign*.47,.045,.16],['forearm'+side]:[sign*.59,-.28,.22],['hand'+side]:[sign*.63,-.49,.27],['thigh'+side]:[sign*.34,-.57,.10],['shin'+side]:[sign*.36,-.77,.12],['foot'+side]:[sign*.36,-.91,.20]});
const byNode=new Map(j.skins[0].joints.map((index,i)=>[bones[i],index])),oldLocal=new Map(bones.map(b=>[b,b.position.clone()])),worlds=new Map(bones.map(b=>[b,b.matrixWorld.clone()]));
for(const b of bones){if(locations[b.name])worlds.get(b).setPosition(new T.Vector3().fromArray(locations[b.name]));}
for(const b of bones){const parent=worlds.get(b.parent)??b.parent.matrixWorld,local=parent.clone().invert().multiply(worlds.get(b)),p=new T.Vector3(),q=new T.Quaternion(),scale=new T.Vector3();local.decompose(p,q,scale);b.position.copy(p);b.quaternion.copy(q);b.scale.copy(scale);Object.assign(j.nodes[byNode.get(b)],{translation:p.toArray(),rotation:q.toArray(),scale:scale.toArray()});}
m.update();const inverse=new Float32Array(bones.length*16);bones.forEach((b,i)=>b.matrixWorld.clone().invert().toArray(inverse,i*16));j.skins[0].inverseBindMatrices=add(inverse,'MAT4');
for(const a of j.animations)for(const c of a.channels)if(c.target.path==='translation'){const b=bones.find(x=>byNode.get(x)===c.target.node);if(!b)continue;const delta=b.position.clone().sub(oldLocal.get(b));if(delta.length()<1e-8)continue;const sampler=a.samplers[c.sampler],r=await readStudioAccessor(j,bin,sampler.output),values=r.values.slice();for(let k=0;k<values.length;k+=3)if(sampler.interpolation!=='CUBICSPLINE'||Math.floor(k/3)%3===1){values[k]+=delta.x;values[k+1]+=delta.y;values[k+2]+=delta.z;}sampler.output=add(values,'VEC3');}
const iv=j.bufferViews[j.images[0].bufferView],tex=await sharp(bin.subarray(iv.byteOffset??0,(iv.byteOffset??0)+iv.byteLength)).ensureAlpha().raw().toBuffer({resolveWithObject:true});
const vertices=[];for(let i=0;i<g.attributes.position.count;i++){const p=new T.Vector3().fromBufferAttribute(g.attributes.position,i),uv=[g.attributes.uv.getX(i),g.attributes.uv.getY(i)],o=(Math.min(tex.info.height-1,Math.max(0,Math.floor(uv[1]*tex.info.height)))*tex.info.width+Math.min(tex.info.width-1,Math.max(0,Math.floor(uv[0]*tex.info.width))))*4,rgb=[...tex.data.subarray(o,o+3)];vertices.push({p,n:new T.Vector3().fromBufferAttribute(g.attributes.normal,i),uv,rgb,brown:p.y>.43&&(p.z<.50||p.y>.72)&&rgb[0]>rgb[1]*1.08&&rgb[1]>rgb[2]*1.2});}
const faceGreen=vertices.filter(v=>v.p.z>.65&&v.p.y>.25&&v.p.y<.5&&Math.abs(v.p.x)<.15).sort((a,b)=>Math.abs(a.rgb[0]-158)+Math.abs(a.rgb[1]-181)+Math.abs(a.rgb[2]-78)-Math.abs(b.rgb[0]-158)-Math.abs(b.rgb[1]-181)-Math.abs(b.rgb[2]-78))[0];
const kept=[];let removed=0;for(let i=0;i<g.index.count;i+=3){const tri=[0,1,2].map(k=>g.index.getX(i+k));if(tri.some(v=>vertices[v].brown)){removed++;continue;}kept.push(...tri);}
const smooth=(a,b,x)=>{const t=T.MathUtils.clamp((x-a)/(b-a),0,1);return t*t*(3-2*t);};
const idx=name=>{const i=bones.findIndex(b=>b.name===name);if(i<0)throw Error(name);return i;};
function skin(p,rgb){const weights=new Map(),put=(name,w)=>{if(w>1e-7)weights.set(idx(name),(weights.get(idx(name))??0)+w);};
 const head=Math.max(smooth(.05,.18,p.y),smooth(-.24,-.14,p.y)*smooth(.39,.50,p.z));
 if(head>.999){put('head',1);return weights;}
 const arm=smooth(.40,.54,Math.abs(p.x))*(1-smooth(-.16,-.04,-p.z))*(1-smooth(.06,.15,p.y))*smooth(-.85,-.69,p.y);
 const leg=(1-smooth(-.72,-.58,p.y))*smooth(.13,.23,Math.abs(p.x))*(1-smooth(.44,.56,Math.abs(p.x)))*smooth(-.34,-.17,p.z);
 let rest=1-head;put('head',head);
 if(arm>0){const a=arm*rest,side=p.x>0?'L':'R',hand=1-smooth(-.51,-.43,p.y),fore=(1-smooth(-.31,-.19,p.y))*(1-hand);put('hand'+side,a*hand);put('forearm'+side,a*fore);put('upper_arm'+side,a*(1-hand-fore));rest*=1-arm;}
 if(leg>0){const a=leg*rest,side=p.x>0?'L':'R',foot=1-smooth(-.89,-.83,p.y),shin=(1-smooth(-.76,-.69,p.y))*(1-foot);put('foot'+side,a*foot);put('shin'+side,a*shin);put('thigh'+side,a*(1-foot-shin));rest*=1-leg;}
 if(p.z<-.43&&p.y<-.67){put('tail_1',rest);return weights;}
 const upper=smooth(-.40,.03,p.y),lower=1-smooth(-.58,-.29,p.y);put('chest',rest*upper);put('pelvis',rest*lower*(1-upper));put('spine',rest*(1-upper)*(1-lower));return weights;
}
const positions=[],normals=[],uvs=[],joints=[],weights=[],map=new Map(),indices=[];
function append(v,w){const i=positions.length/3;positions.push(...v.p.toArray());normals.push(...v.n.toArray());uvs.push(...v.uv);let entries=[...w].sort((a,b)=>b[1]-a[1]).slice(0,4),sum=entries.reduce((a,b)=>a+b[1],0);for(let k=0;k<4;k++){joints.push(entries[k]?.[0]??0);weights.push((entries[k]?.[1]??0)/sum);}return i;}
for(const old of kept){if(!map.has(old))map.set(old,append(vertices[old],skin(vertices[old].p,vertices[old].rgb)));indices.push(map.get(old));}
// A smooth scalp replaces the misplaced shell cap; all UVs sample green skin.
const sphere=new T.SphereGeometry(1,64,32),center=new T.Vector3(0,.47,.18),radius=new T.Vector3(.60,.515,.65),scalpMap=new Map();
const scalpPoint=i=>new T.Vector3().fromBufferAttribute(sphere.attributes.position,i).multiply(radius).add(center);
for(let i=0;i<sphere.index.count;i+=3){const tri=[0,1,2].map(k=>sphere.index.getX(i+k)),c=new T.Vector3();for(const v of tri)c.add(scalpPoint(v));c.divideScalar(3);if(c.y<.43+.25*smooth(-.1,.45,c.z))continue;for(const old of tri){if(!scalpMap.has(old)){const p=scalpPoint(old),n=new T.Vector3().fromBufferAttribute(sphere.attributes.normal,old).divide(radius).normalize();scalpMap.set(old,append({p,n,uv:faceGreen.uv},new Map([[idx('head'),1]])));}indices.push(scalpMap.get(old));}}
const attributes={POSITION:add(new Float32Array(positions),'VEC3'),NORMAL:add(new Float32Array(normals),'VEC3'),TEXCOORD_0:add(new Float32Array(uvs),'VEC2'),JOINTS_0:add(new Uint16Array(joints),'VEC4',5123),WEIGHTS_0:add(new Float32Array(weights),'VEC4')};
j.meshes[0].primitives=[{attributes,indices:add(new Uint32Array(indices),'SCALAR',5125),material:j.meshes[0].primitives[0].material,mode:4}];j.extras.pebbleDistinctRebuild={revision:'20261019-pebble-distinct-model-v1',source:'starter-earth.glb',sourceSha256:originalSha,sharedStoneTurtleGeometry:false,removedCapTriangles:removed,scalpVertices:scalpMap.size,retargetedJoints:locations};
delete j.extras.studioPolish;delete j.extras.properAnimationSourceBoundary;
j.buffers[0].byteLength=binary.length;const compacted=parseStudioGlb(compactGlbDelivery(encodeStudioGlb(j,binary)));compacted.json.extras.properAnimationSourceBoundary={binLength:compacted.bin.length,accessorCount:compacted.json.accessors.length,bufferViewCount:compacted.json.bufferViews.length};
await writeFile(destination,encodeStudioGlb(compacted.json,compacted.bin));await rm(source);
const after=await loadPetDeformationProbe(destination);assert.deepEqual(after.animations.map(c=>c.name),m.animations.map(c=>c.name));for(let i=0;i<m.animations.length;i++)assert.equal(after.animations[i].duration,m.animations[i].duration);
return{sourceSha256:originalSha,sha256:after.sha256,removedCapTriangles:removed,vertices:positions.length/3,triangles:indices.length/3,scalpVertices:scalpMap.size,green:faceGreen.rgb,animations:after.animations.map(c=>c.name),sharedStoneTurtleGeometry:false};
}
if(process.argv[1]&&resolve(process.argv[1])===resolve(import.meta.filename))console.log(await rebuildPebbleTortoise(process.argv[2],process.argv[3]));
