import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {parseStudioGlb,encodeStudioGlb,readStudioAccessor,align4} from './pet-studio-glb.mjs';
import * as T from 'three';
import {loadPetDeformationProbeBytes} from './pet-deformation-probe.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');

/** Bind the visibly frozen head-side tabs to the skull, preserving actual wings. */
export async function repairSkyFalconTabs(bytes){
    const selectionBytes=await readFile(new URL('../fixtures/pet-sky-falcon-tabs-20261021/frozen-selection.json',import.meta.url));
    assert.equal(sha(selectionBytes),'d7d3beda7bfabdc7cf09660c456a00c691553462efa42cfd10f1b254f8edd4fc');
    const selection=JSON.parse(selectionBytes);
    assert.equal(sha(bytes),selection.sourcePin.sha256,'Unexpected Sky Falcon tab source');
    const {json,bin}=parseStudioGlb(bytes),primitive=json.meshes[0].primitives[0],skin=json.skins[0];
    const head=skin.joints.findIndex(node=>json.nodes[node].name==='head');assert.ok(head>=0);
    const jointAccessor=json.accessors[primitive.attributes.JOINTS_0],weightAccessor=json.accessors[primitive.attributes.WEIGHTS_0];
    assert.equal(jointAccessor.componentType,5121);assert.equal(weightAccessor.componentType,5121);assert.equal(weightAccessor.normalized,true);
    const joints=Uint8Array.from((await readStudioAccessor(json,bin,primitive.attributes.JOINTS_0)).values);
    const weights=Uint8Array.from((await readStudioAccessor(json,bin,primitive.attributes.WEIGHTS_0)).values,x=>Math.round(x*255));
    const frozen=selection.vertexUnion.sourceVertexIds;assert.equal(new Set(frozen).size,234);
    // The complete tab back surface has wing contamination at head-local
    // y >= .0377; actual wing/chest mixed surfaces end below -.0243. Use
    // that empty anatomical interval, rather than a visible raycast boundary.
    const model=await loadPetDeformationProbeBytes(bytes),mesh=model.meshes[0];
    const inverse=mesh.skeleton.bones.find(b=>b.name==='head').matrixWorld.clone().invert();
    const selectedSet=new Set(frozen);
    for(let v=0;v<weightAccessor.count;v++){
        let headShare=0,wingShare=0;
        for(let k=0;k<4;k++){const j=joints[v*4+k],w=weights[v*4+k];if(j===head)headShare+=w;if(json.nodes[skin.joints[j]].name.startsWith('wing'))wingShare+=w;}
        const p=mesh.getVertexPosition(v,new T.Vector3()).applyMatrix4(mesh.matrixWorld).applyMatrix4(inverse);
        if(headShare>0&&wingShare>0&&p.y>=0)selectedSet.add(v);
    }
    for(const surface of model.meshes)surface.geometry.dispose();
    const selected=[...selectedSet].sort((a,b)=>a-b);
    let changed=0;
    for(const vertex of selected){
        assert.ok(Number.isInteger(vertex)&&vertex>=0&&vertex<weightAccessor.count);
        let headWeight=0;for(let k=0;k<4;k++)if(joints[vertex*4+k]===head)headWeight+=weights[vertex*4+k];
        if(headWeight===255)continue;
        joints.set([head,0,0,0],vertex*4);weights.set([255,0,0,0],vertex*4);changed++;
    }
    assert.ok(changed>=122&&selected.length<500,'Unexpected surface closure; re-diagnose instead of expanding the selection');
    let binary=bin;
    const append=(array,normalized=false)=>{const offset=align4(binary.length);binary=Buffer.concat([binary,Buffer.alloc(offset-binary.length),Buffer.from(array)]);const bufferView=json.bufferViews.push({buffer:0,byteOffset:offset,byteLength:array.length})-1;return json.accessors.push({bufferView,componentType:5121,type:'VEC4',count:array.length/4,...(normalized?{normalized:true}:{})})-1;};
    primitive.attributes.JOINTS_0=append(joints);primitive.attributes.WEIGHTS_0=append(weights,true);
    json.extras??={};json.extras.headTabBindingRepair={revision:'20261021-falcon-head-tabs-v4',sourceSha256:sha(bytes),selectionSha256:sha(selectionBytes),frozenVisibleVertices:frozen.length,selectedVertices:selected.length,selectedVertexIds:selected,closure:'Complete source-pinned upper head accessory volume. Head-local y=0 lies in an empty wing/head contamination gap (-.0243,.0377); frozen visible picks retained.',changedVertices:changed,actualWingBindingsRetained:true};
    json.extras.properAnimationSourceBoundary={binLength:align4(binary.length),accessorCount:json.accessors.length,bufferViewCount:json.bufferViews.length};json.buffers[0].byteLength=align4(binary.length);
    const output=encodeStudioGlb(json,binary);
    return {bytes:output,report:{...json.extras.headTabBindingRepair,sha256:sha(output)}};
}
