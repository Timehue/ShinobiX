// Reproduce the independently reviewed removal of Loam Marmot’s duplicate tail.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import * as THREE from 'three';
import sharp from 'sharp';
import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {compactPrimitive} from '@gltf-transform/functions';
import {MeshoptDecoder,MeshoptEncoder} from 'meshoptimizer';
import {parseStudioGlb,encodeStudioGlb} from './pet-studio-glb.mjs';
import {loadPetDeformationProbeBytes} from './pet-deformation-probe.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
export async function repairLoamMarmotDuplicateTail(original){
assert.equal(sha(original),'8a9f82c8ac40aedbd389a63e9dd8a096f9b5dfffaac048d8a53dc354187f66ec');
await Promise.all([MeshoptDecoder.ready,MeshoptEncoder.ready]);
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'meshopt.decoder':MeshoptDecoder,'meshopt.encoder':MeshoptEncoder});
const document=await io.readBinary(original),model=await loadPetDeformationProbeBytes(original),mesh=model.meshes[0],p=mesh.geometry.attributes.position,index=mesh.geometry.index,primitive=document.getRoot().listMeshes()[0].listPrimitives()[0];
assert.equal(primitive.getAttribute('POSITION').getCount(),p.count);assert.equal(primitive.getIndices().getCount(),index.count);
const originalIndices=Array.from(index.array),keys=Array.from({length:p.count},(_,v)=>[p.getX(v),p.getY(v),p.getZ(v)].map(x=>Math.round(x*1e6)).join(','));
const edgeKey=(a,b)=>a<b?a+'|'+b:b+'|'+a;
function edges(indices){const map=new Map();for(let t=0;t<indices.length;t+=3)for(const[a,b]of [[0,1],[1,2],[2,0]]){const from=indices[t+a],to=indices[t+b],k=edgeKey(keys[from],keys[to]);if(!map.has(k))map.set(k,{count:0,from,to});map.get(k).count++;}return map;}
const beforeEdges=edges(originalIndices),removedVertices=new Set();
const texture=primitive.getMaterial().getBaseColorTexture();assert.ok(texture?.getImage());
const{data:diffuse,info}=await sharp(texture.getImage()).removeAlpha().raw().toBuffer({resolveWithObject:true});
for(let v=0;v<p.count;v++){
 const uv=mesh.geometry.attributes.uv,x=Math.max(0,Math.min(info.width-1,Math.round(uv.getX(v)*(info.width-1)))),y=Math.max(0,Math.min(info.height-1,Math.round(uv.getY(v)*(info.height-1)))),offset=(y*info.width+x)*info.channels,r=diffuse[offset],g=diffuse[offset+1],b=diffuse[offset+2],brown=r>g*1.15&&r>b*1.35;
 if(p.getX(v)<-.035&&p.getY(v)<-.44&&p.getZ(v)<.05&&brown)removedVertices.add(v);
}
let kept=[],removed=[];for(let t=0;t<index.count;t+=3){const tri=originalIndices.slice(t,t+3);(tri.some(v=>removedVertices.has(v))?removed:kept).push(...tri);}
assert.ok(removed.length>90&&removed.length<index.count*.08,'Region must isolate a small duplicate appendage');
let rounds=0;for(;;){const e=edges(kept),degree=new Map();for(const [k,v]of e)if(v.count===1&&(beforeEdges.get(k)?.count??0)>1)for(const id of [keys[v.from],keys[v.to]])degree.set(id,(degree.get(id)??0)+1);const bad=new Set([...degree].filter(([,n])=>n!==2).map(([key])=>key));if(!bad.size)break;assert.ok(rounds++<40,'Cut boundary failed to converge');const retained=[];for(let i=0;i<kept.length;i+=3){const tri=kept.slice(i,i+3);(tri.some(v=>bad.has(keys[v]))?removed:retained).push(...tri);}kept=retained;}assert.ok(removed.length<index.count*.12,'Cut must remain localized');
const afterEdges=edges(kept),boundary=[...afterEdges.entries()].filter(([k,e])=>e.count===1&&(beforeEdges.get(k)?.count??0)>1).map(([,e])=>e);
const adjacent=new Map(),vertexForKey=new Map();for(const e of boundary)for(const[from,to]of [[e.from,e.to],[e.to,e.from]]){const k=keys[from];vertexForKey.set(k,from);if(!adjacent.has(k))adjacent.set(k,new Set());adjacent.get(k).add(keys[to]);}
for(const neighbours of adjacent.values())assert.equal(neighbours.size,2,'Cut boundary must have no branches');
const unvisited=new Set(adjacent.keys()),loops=[],caps=[];
while(unvisited.size){const start=unvisited.values().next().value,loop=[start];let prior=null,current=start;
 for(let guard=0;guard<=adjacent.size;guard++){unvisited.delete(current);const next=[...adjacent.get(current)].find(k=>k!==prior);if(next===start)break;assert.ok(unvisited.has(next),'Non-simple cut');loop.push(next);prior=current;current=next;}
 assert.ok(loop.length>=3);loops.push(loop);const vertices=loop.map(k=>vertexForKey.get(k)),positions=vertices.map(v=>new THREE.Vector3().fromBufferAttribute(p,v)),normal=new THREE.Vector3();
 for(let i=0;i<positions.length;i++)normal.add(new THREE.Vector3().crossVectors(positions[i],positions[(i+1)%positions.length]));normal.normalize();assert.ok(normal.length()>.99);
 const n=vertices.length,cost=Array.from({length:n},()=>Array(n).fill(Infinity)),split=Array.from({length:n},()=>Array(n).fill(-1));for(let i=0;i<n-1;i++)cost[i][i+1]=0;
 for(let gap=2;gap<n;gap++)for(let i=0;i+gap<n;i++){const j=i+gap;for(let k=i+1;k<j;k++){const a=positions[i],b=positions[k],c=positions[j],cross=new THREE.Vector3().subVectors(b,a).cross(new THREE.Vector3().subVectors(c,a)),area=cross.length()*.5,perimeter=a.distanceTo(b)+b.distanceTo(c)+c.distanceTo(a);const score=cost[i][k]+cost[k][j]+area+perimeter*1e-5;if(score<cost[i][j]){cost[i][j]=score;split[i][j]=k;}}}
 const triangles=[];function fill(i,j){if(j-i<2)return;const k=split[i][j];assert.ok(k>i&&k<j);triangles.push([vertices[i],vertices[k],vertices[j]]);fill(i,k);fill(k,j);}fill(0,n-1);assert.equal(triangles.length,n-2);
 const candidate=triangles.flat(),newEdges=edges(candidate);let same=0,opposite=0;for(const e of boundary){const cap=newEdges.get(edgeKey(keys[e.from],keys[e.to]));if(!cap||cap.count!==1)continue;if(keys[cap.from]===keys[e.from])same++;else opposite++;}
 assert.ok(same===0||opposite===0,'Cap winding inconsistent');for(const tri of triangles)caps.push(...(same?tri.toReversed():tri));
}
const final=kept.concat(caps),finalEdges=edges(final);for(const e of boundary)assert.equal(finalEdges.get(edgeKey(keys[e.from],keys[e.to])).count,2,'New cut remains open');
// Close the surgically removed tail with a shaded surface whose color follows
// the original cut boundary. Original body texels and body UVs remain intact.
const capVertices=[...new Set(caps)],duplicate=new Map(capVertices.map((v,i)=>[v,p.count+i]));
let best={score:-1,x:0,y:0};for(let y=2;y<info.height-2;y++)for(let x=2;x<info.width-2;x++){let score=255;for(let yy=-1;yy<=1;yy++)for(let xx=-1;xx<=1;xx++)for(let k=0;k<3;k++)score=Math.min(score,diffuse[((y+yy)*info.width+x+xx)*info.channels+k]);if(score>best.score)best={score,x,y};}assert.ok(best.score>210,'Need a neutral bright source texel for the cap UV island');
const white=[0,1,2].map(k=>diffuse[(best.y*info.width+best.x)*info.channels+k]/255),linear=x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4;
const colors=new Float32Array((p.count+capVertices.length)*3).fill(1),boundaryKeys=new Set(boundary.flatMap(e=>[keys[e.from],keys[e.to]])),normalSums=new Map();
for(let t=0;t<final.length;t+=3){const tri=final.slice(t,t+3),points=tri.map(v=>new THREE.Vector3().fromBufferAttribute(p,v)),n=new THREE.Vector3().subVectors(points[1],points[0]).cross(new THREE.Vector3().subVectors(points[2],points[0]));for(const v of tri)if(boundaryKeys.has(keys[v])){if(!normalSums.has(keys[v]))normalSums.set(keys[v],new THREE.Vector3());normalSums.get(keys[v]).add(n);}}
for(const n of normalSums.values())n.normalize();
for(const semantic of primitive.listSemantics()){
 const attr=primitive.getAttribute(semantic),raw=attr.getArray(),width=attr.getElementSize(),array=new raw.constructor((p.count+capVertices.length)*width);array.set(raw);
 for(const [v,nv]of duplicate)array.set(raw.subarray(v*width,v*width+width),nv*width);
 const factor=attr.getNormalized()?(raw instanceof Int16Array?32767:raw instanceof Uint16Array?65535:raw instanceof Uint8Array?255:1):1;
 if(semantic==='NORMAL')for(let v=0;v<p.count;v++)if(normalSums.has(keys[v])){const n=normalSums.get(keys[v]);for(const dest of [v,duplicate.get(v)].filter(x=>x!==undefined))for(let k=0;k<3;k++)array[dest*3+k]=n.getComponent(k)*factor;}
 if(semantic==='TEXCOORD_0')for(const nv of duplicate.values()){array[nv*2]=(best.x+.5)/info.width*factor;array[nv*2+1]=(best.y+.5)/info.height*factor;}
 attr.setArray(array);
}
for(const [v,nv]of duplicate){const uv=mesh.geometry.attributes.uv,x=Math.max(0,Math.min(info.width-1,Math.round(uv.getX(v)*(info.width-1)))),y=Math.max(0,Math.min(info.height-1,Math.round(uv.getY(v)*(info.height-1))));for(let k=0;k<3;k++)colors[nv*3+k]=Math.min(1,linear(diffuse[(y*info.width+x)*info.channels+k]/255)/linear(white[k]));}
primitive.setAttribute('COLOR_0',document.createAccessor('closed-tail-root-colors').setType('VEC3').setArray(colors).setBuffer(primitive.getIndices().getBuffer()));
const newIndices=kept.concat(caps.map(v=>duplicate.get(v)));
const accessor=document.createAccessor('marmot-single-tail-indices').setType('SCALAR').setArray(new Uint32Array(newIndices)).setBuffer(primitive.getIndices().getBuffer());primitive.setIndices(accessor);compactPrimitive(primitive);
for(const a of document.getRoot().listAccessors())if(!a.getBuffer())a.setBuffer(document.getRoot().listBuffers()[0]);
const normalized=parseStudioGlb(Buffer.from(await io.writeBinary(document)));
normalized.json.extras??={};
normalized.json.extras.properAnimationSourceBoundary={binLength:normalized.bin.length,accessorCount:normalized.json.accessors.length,bufferViewCount:normalized.json.bufferViews.length};
const bytes=encodeStudioGlb(normalized.json,normalized.bin);
return {bytes,report:{sourceSha256:sha(original),candidateSha256:sha(bytes),removedTriangles:removed.length/3,capTriangles:caps.length/3,cutLoopLengths:loops.map(loop=>loop.length),newCutEdgesClosed:true}};
}
