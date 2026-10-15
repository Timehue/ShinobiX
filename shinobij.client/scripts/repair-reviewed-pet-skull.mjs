import { readFile,writeFile,mkdir } from 'node:fs/promises';
import { resolve,dirname } from 'node:path';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { MeshoptEncoder } from 'meshoptimizer';
import { runtimePetModels } from './lib/pet-runtime-audit.mjs';
import { loadPetDeformationProbe } from './lib/pet-deformation-probe.mjs';
import { petSkullRegionShare,petSkullEnvelopeMatrix } from './lib/pet-skull-region.mjs';
import { parseStudioGlb,encodeStudioGlb,align4 } from './lib/pet-studio-glb.mjs';
import { compactGlbDelivery } from './compact-glb-delivery.mjs';

export async function repairReviewedPetSkull(id,source,destination,config) {
    if(resolve(source)===resolve(destination))throw Error('Inspect a separate candidate before promotion');
    if(config.status!=='repair')throw Error(`${id}: anatomical region is not authorized for a confirmed repair`);
    const row=runtimePetModels.find(row=>row.pet.id===id);if(!row)throw Error('Unknown pet');
    const bytes=await readFile(source),{json,bin}=parseStudioGlb(bytes),model=await loadPetDeformationProbe(source);
    if(model.meshes.length!==1)throw Error(`${id}: multiple surfaces need individual anatomical masks`);
    if(json.extras?.reviewedSkullRepair)throw Error('Use the recorded original for a new candidate');
    const envelope=petSkullEnvelopeMatrix(model,row.model.yawOffset),mesh=model.meshes[0],head=mesh.skeleton.bones.findIndex(b=>b.name===(config.anchorBone??'head'));
    if(head<0)throw Error(`${id}: reviewed anchor bone missing`);
    const {position,skinIndex,skinWeight}=mesh.geometry.attributes,point=new THREE.Vector3();
    const precise=config.weightPrecision==='float32';
    const joints=new Uint8Array(position.count*4),weights=precise?new Float32Array(position.count*4):new Uint8Array(position.count*4);
    let changed=0,rigid=0;
    for(let v=0;v<position.count;v++) {
        point.fromBufferAttribute(position,v).applyMatrix4(envelope);const share=petSkullRegionShare(point,config);
        if(!share) {for(let s=0;s<4;s++){joints[v*4+s]=skinIndex.getComponent(v,s);weights[v*4+s]=precise?skinWeight.getComponent(v,s):Math.round(skinWeight.getComponent(v,s)*255);}continue;}
        const influences=new Map();for(let s=0;s<4;s++){const j=skinIndex.getComponent(v,s);influences.set(j,(influences.get(j)??0)+skinWeight.getComponent(v,s)*(1-share));}
        influences.set(head,(influences.get(head)??0)+share);
        const ranked=[...influences].filter(([,w])=>w>0).sort((a,b)=>b[1]-a[1]).slice(0,4),total=ranked.reduce((n,[,w])=>n+w,0);
        ranked.forEach(([j,w],s)=>{joints[v*4+s]=j;weights[v*4+s]=precise?w/total:Math.round(w/total*255);});
        if(!precise)weights[v*4]+=255-weights.subarray(v*4,v*4+4).reduce((n,w)=>n+w,0);changed++;if(share===1)rigid++;
    }
    if(rigid<100)throw Error('Insufficient reviewed skull coverage');
    await MeshoptEncoder.ready;let binary=bin;
    let fallback=json.buffers.findIndex(b=>b.extensions?.EXT_meshopt_compression?.fallback);
    if(fallback<0){fallback=json.buffers.length;json.buffers.push({byteLength:0,extensions:{EXT_meshopt_compression:{fallback:true}}});}
    const append=(array,normalized)=>{
        const bytes=Buffer.from(array.buffer,array.byteOffset,array.byteLength),stride=array.BYTES_PER_ELEMENT*4;
        const packed=MeshoptEncoder.encodeGltfBuffer(bytes,position.count,stride,'ATTRIBUTES'),offset=align4(binary.length),rawOffset=align4(json.buffers[fallback].byteLength);
        binary=Buffer.concat([binary,Buffer.alloc(offset-binary.length),packed]);json.buffers[fallback].byteLength=rawOffset+bytes.length;
        const view=json.bufferViews.push({buffer:fallback,byteOffset:rawOffset,byteLength:bytes.length,byteStride:stride,target:34962,
            extensions:{EXT_meshopt_compression:{buffer:0,byteOffset:offset,byteLength:packed.length,byteStride:stride,count:position.count,mode:'ATTRIBUTES'}}})-1;
        return json.accessors.push({bufferView:view,componentType:array instanceof Float32Array?5126:5121,count:position.count,type:'VEC4',...(normalized&&!(array instanceof Float32Array)?{normalized:true}:{})})-1;
    };
    const p=json.meshes[0].primitives[0];p.attributes.JOINTS_0=append(joints,false);p.attributes.WEIGHTS_0=append(weights,true);json.buffers[0].byteLength=align4(binary.length);
    json.extras.reviewedSkullRepair={revision:'20261014-reviewed-skull-v1',id,sourceSha256:createHash('sha256').update(bytes).digest('hex'),region:config,envelopeMatrix:envelope.toArray(),changedVertices:changed,rigidVertices:rigid};
    const compacted=parseStudioGlb(compactGlbDelivery(encodeStudioGlb(json,binary)));
    compacted.json.extras.properAnimationSourceBoundary={binLength:compacted.bin.length,accessorCount:compacted.json.accessors.length,bufferViewCount:compacted.json.bufferViews.length};
    await mkdir(dirname(destination),{recursive:true});await writeFile(destination,encodeStudioGlb(compacted.json,compacted.bin));return {id,changed,rigid};
}
if(process.argv[1]&&resolve(process.argv[1])===resolve(import.meta.filename)) {
    const id=process.argv[2],regions=JSON.parse(await readFile(resolve(import.meta.dirname,'pet-skull-regions.json'))).pets;
    console.log(JSON.stringify(await repairReviewedPetSkull(id,resolve(process.argv[3]),resolve(process.argv[4]),regions[id])));
}
