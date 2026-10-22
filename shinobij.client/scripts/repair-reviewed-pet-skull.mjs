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
import { repairPetSkinWeights, packContinuousPetSkinWeights } from '../src/lib/pet-skin-weight-repair.ts';
import { transferReviewedPetBinding } from './lib/pet-reference-binding.mjs';
import { applyReviewedAnimationClearance } from './lib/pet-animation-clearance.mjs';

export async function repairReviewedPetSkull(id,source,destination,config) {
    if(resolve(source)===resolve(destination))throw Error('Inspect a separate candidate before promotion');
    if(config.status!=='repair')throw Error(`${id}: anatomical region is not authorized for a confirmed repair`);
    const row=runtimePetModels.find(row=>row.pet.id===id);if(!row)throw Error('Unknown pet');
    const bytes=await readFile(source),{json,bin}=parseStudioGlb(bytes),model=await loadPetDeformationProbe(source);
    if(model.meshes.length!==1)throw Error(`${id}: multiple surfaces need individual anatomical masks`);
    const sourceSha256=createHash('sha256').update(bytes).digest('hex'),previousRepair=json.extras?.reviewedSkullRepair;
    if(previousRepair&&config.supersedesSourceSha256!==sourceSha256)throw Error('Use the recorded original or pin the reviewed source being superseded');
    if(config.supersedesSourceSha256&&config.supersedesSourceSha256!==sourceSha256)throw Error('The complete-face repair requires its pinned reviewed source');
    if(config.repairRegion&&!config.supersedesSourceSha256)throw Error('An incremental region requires a pinned reviewed source');
    const envelope=petSkullEnvelopeMatrix(model,row.model.yawOffset),mesh=model.meshes[0],head=mesh.skeleton.bones.findIndex(b=>b.name===(config.anchorBone??'head'));
    if(head<0)throw Error(`${id}: reviewed anchor bone missing`);
    const {position,skinIndex,skinWeight}=mesh.geometry.attributes,point=new THREE.Vector3();
    const frozenSurface=new Set(config.frozenHeadSurface?.indices??[]);
    if(frozenSurface.size&&(!config.supersedesSourceSha256||config.frozenHeadSurface.sourceSha256!==sourceSha256||[...frozenSurface].some(v=>!Number.isInteger(v)||v<0||v>=position.count)))throw Error('A frozen head surface requires valid original vertex indices and the exact reviewed source');
    const precise=config.weightPrecision==='float32';
    const joints=new Uint8Array(position.count*4),weights=precise?new Float32Array(position.count*4):new Uint8Array(position.count*4);
    let changed=0,rigid=0;
    const supports=(config.supportBindings??[]).map(binding=>{
        const joint=mesh.skeleton.bones.findIndex(b=>b.name===binding.anchorBone);
        if(joint<0||!binding.region?.y)throw Error('Invalid reviewed supporting skin binding');
        return {...binding,joint};
    });
    for(let v=0;v<position.count;v++) {
        // A later accessory repair must not reapply and strengthen the earlier
        // face/neck blend. Keep those already reviewed bindings byte-for-byte.
        point.fromBufferAttribute(position,v).applyMatrix4(envelope);const share=frozenSurface.has(v)?1:petSkullRegionShare(point,config.repairRegion??config);
        const supportShares=supports.map(binding=>petSkullRegionShare(point,binding.region));
        if(!share&&!supportShares.some(value=>value>0)) {for(let s=0;s<4;s++){joints[v*4+s]=skinIndex.getComponent(v,s);weights[v*4+s]=precise?skinWeight.getComponent(v,s):Math.round(skinWeight.getComponent(v,s)*255);}continue;}
        const influences=new Map();for(let s=0;s<4;s++){const j=skinIndex.getComponent(v,s);influences.set(j,(influences.get(j)??0)+skinWeight.getComponent(v,s)*(supports.length?1:1-share));}
        const supportingShare=1-(influences.get(head)??0);
        supports.forEach((binding,i)=>{const amount=supportShares[i]*supportingShare;for(const[j,w]of influences)influences.set(j,w*(1-amount));influences.set(binding.joint,(influences.get(binding.joint)??0)+amount);});
        if(supports.length)for(const[j,w]of influences)influences.set(j,w*(1-share));
        influences.set(head,(influences.get(head)??0)+share);
        const ordered=[...influences].filter(([,w])=>w>0).sort((a,b)=>b[1]-a[1]);
        // A head repair can introduce a fifth influence beside the four body
        // influences. Fade the weakest retained weights at that palette tie
        // instead of creating an abrupt seam when the fifth is discarded.
        const floor=config.continuousInfluencePacking&&ordered.length>4?ordered[4][1]:0;
        const ranked=ordered.slice(0,4).map(([j,w])=>[j,w-floor]),total=ranked.reduce((n,[,w])=>n+w,0);
        ranked.forEach(([j,w],s)=>{joints[v*4+s]=j;weights[v*4+s]=precise?w/total:Math.round(w/total*255);});
        if(!precise)weights[v*4]+=255-weights.subarray(v*4,v*4+4).reduce((n,w)=>n+w,0);changed++;if(share===1)rigid++;
    }
    if(rigid<100)throw Error('Insufficient reviewed skull coverage');
    if(config.neckTransition){
        const {iterations,edges,protectBelowY,featherY=0,region:transitionRegion}=config.neckTransition;
        if(!Number.isInteger(iterations)||iterations<1||iterations>64||!Number.isFinite(protectBelowY)||!Number.isFinite(featherY)||featherY<0||featherY>1||!edges?.length||edges.some(pair=>pair.length!==2||pair.some(v=>!Number.isInteger(v)||v<0||v>=position.count)))throw Error('Invalid measured neck-transition repair');
        const bound=mesh.geometry.clone();
        bound.setAttribute('skinIndex',new THREE.Uint8BufferAttribute(joints,4));
        bound.setAttribute('skinWeight',precise?new THREE.Float32BufferAttribute(weights,4):new THREE.Uint8BufferAttribute(weights,4,true));
        const transition=repairPetSkinWeights(bound,mesh.skeleton.bones.length,head,iterations,edges);
        if(!transition)throw Error('Unable to repair the measured connected transition');
        const nextJoints=transition.geometry.attributes.skinIndex,nextWeights=transition.geometry.attributes.skinWeight;
        for(let v=0;v<position.count;v++){
            point.fromBufferAttribute(position,v).applyMatrix4(envelope);
            if(point.y<protectBelowY)continue;
            // Fade back to the original bindings before the protected body.
            // A hard cutoff can create a fresh crease along the lower edge.
            const t=featherY?Math.max(0,Math.min(1,(point.y-protectBelowY)/featherY)):1,transitionShare=t*t*(3-2*t)*(transitionRegion?petSkullRegionShare(point,transitionRegion):1);
            if(transitionShare===0)continue;
            if(transitionShare<1){
                const share=transitionShare,values=new Float32Array(mesh.skeleton.bones.length);
                for(let s=0;s<4;s++){values[joints[v*4+s]]+=(precise?weights[v*4+s]:weights[v*4+s]/255)*(1-share);values[nextJoints.getComponent(v,s)]+=nextWeights.getComponent(v,s)*share;}
                const packed=packContinuousPetSkinWeights(values);
                for(let s=0;s<4;s++){joints[v*4+s]=packed.joints[s]??0;weights[v*4+s]=precise?(packed.weights[s]??0):Math.round((packed.weights[s]??0)*255);}
                if(!precise)weights[v*4]+=255-weights.subarray(v*4,v*4+4).reduce((n,w)=>n+w,0);
                continue;
            }
            for(let s=0;s<4;s++){joints[v*4+s]=nextJoints.getComponent(v,s);weights[v*4+s]=precise?nextWeights.getComponent(v,s):Math.round(nextWeights.getComponent(v,s)*255);}
            if(!precise)weights[v*4]+=255-weights.subarray(v*4,v*4+4).reduce((n,w)=>n+w,0);
        }
        bound.dispose();transition.geometry.dispose();
    }
    let bindingTransfer;
    if(config.bindingReference){
        if(config.neckTransition||precise)throw Error('Reference transfer requires a separate reviewed binding configuration');
        const transfer=await transferReviewedPetBinding(model,config.bindingReference);
        joints.set(transfer.joints);weights.set(transfer.weights);
        // The detailed surface can retain a tiny reference interpolation at a
        // cheek rim. Keep the reviewed skull rigid, and optionally retain
        // original rigid head ownership throughout the transferred surface.
        for(let v=0;v<position.count;v++){
            point.fromBufferAttribute(position,v).applyMatrix4(envelope);
            let originalHeadShare=0;
            for(let s=0;s<4;s++)if(skinIndex.getComponent(v,s)===head)originalHeadShare+=skinWeight.getComponent(v,s);
            if(petSkullRegionShare(point,config)!==1&&!(config.preserveRigidHeadBinding&&originalHeadShare>.999999))continue;
            for(let s=0;s<4;s++){joints[v*4+s]=s===0?head:0;weights[v*4+s]=s===0?255:0;}
        }
        bindingTransfer={referenceSha256:config.bindingReference.sha256,vertices:transfer.vertices,maximumProjectionDistance:transfer.maximumProjectionDistance};
    }
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
    json.extras.reviewedSkullRepair={revision:config.revision??'20261014-reviewed-skull-v1',id,sourceSha256,region:config,envelopeMatrix:envelope.toArray(),changedVertices:changed,rigidVertices:rigid,
        ...(previousRepair?{supersededRepair:{revision:previousRepair.revision,sourceSha256:previousRepair.sourceSha256}}:{}),...(bindingTransfer?{bindingTransfer}:{})};
    binary=await applyReviewedAnimationClearance(json,binary,config.animationClearance);
    const compacted=parseStudioGlb(compactGlbDelivery(encodeStudioGlb(json,binary)));
    compacted.json.extras.properAnimationSourceBoundary={binLength:compacted.bin.length,accessorCount:compacted.json.accessors.length,bufferViewCount:compacted.json.bufferViews.length};
    await mkdir(dirname(destination),{recursive:true});await writeFile(destination,encodeStudioGlb(compacted.json,compacted.bin));return {id,changed,rigid};
}
if(process.argv[1]&&resolve(process.argv[1])===resolve(import.meta.filename)) {
    const id=process.argv[2],regions=JSON.parse(await readFile(resolve(import.meta.dirname,'pet-skull-regions.json'))).pets;
    console.log(JSON.stringify(await repairReviewedPetSkull(id,resolve(process.argv[3]),resolve(process.argv[4]),regions[id])));
}
