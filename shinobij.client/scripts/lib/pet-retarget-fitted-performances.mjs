import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {Quaternion} from 'three';
import {parseStudioGlb,encodeStudioGlb,align4,readStudioAccessor} from './pet-studio-glb.mjs';
import {createCharacterRig} from './pet-character-motion.mjs';
import {compactGlbDelivery} from '../compact-glb-delivery.mjs';

export const OMITTED_FITTED_PERFORMANCE_CLIPS=['idle_2','gallop_jump','death','entrance','victory'];
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const oldName=name=>'legacy_'+name;

/** Retain the authored local rotation delta in the fitted joint's bind frame.
 * Both quaternion keys and cubic derivatives receive the same constant linear
 * change of basis. No guessed gait, root correction or artificial movement is
 * inserted into clips where the original limb has no authored track.
 */
export async function retargetFittedPetPerformances(bytes,{expectedSha256}={}){
    const sourceSha256=sha(bytes);assert.match(expectedSha256??'',/^[a-f0-9]{64}$/,'Pin the reviewed input');
    assert.equal(sourceSha256,expectedSha256,'Unexpected fitted performance source');
    const {json,bin}=parseStudioGlb(bytes),rig=createCharacterRig(json),pairs=[];
    for(const part of ['front','hind'])for(const side of ['L','R'])for(const section of ['upper','lower','paw']){
        const name=`${part}_${section}.${side}`,node=rig.byName.get(name);
        let legacy=rig.byName.get(oldName(name));
        if(legacy===undefined){
            const human=part==='front'?['upper_arm','forearm','hand']:['thigh','shin','foot'];
            const originalName=`${human[['upper','lower','paw'].indexOf(section)]}.${side}`;
            legacy=rig.byName.get(`legacy_${originalName}`)??rig.byName.get(originalName);
        }
        assert.ok(node!==undefined&&legacy!==undefined,`${name}: missing original/fitted pair`);
        const a=rig.nodes[legacy],b=rig.nodes[node];
        const parentA=a.parent.getWorldQuaternion(new Quaternion()),parentB=b.parent.getWorldQuaternion(new Quaternion());
        const left=parentB.clone().invert().multiply(parentA);
        const right=rig.bind[legacy].q.clone().invert().multiply(parentA.clone().invert()).multiply(parentB).multiply(rig.bind[node].q);
        pairs.push({name,node,legacy,left,right});
    }
    let binary=bin;
    function append(values){const offset=align4(binary.length),b=Buffer.from(values.buffer,values.byteOffset,values.byteLength);binary=Buffer.concat([binary,Buffer.alloc(offset-binary.length),b]);const view=json.bufferViews.push({buffer:0,byteOffset:offset,byteLength:b.length})-1;return json.accessors.push({bufferView:view,componentType:5126,count:values.length/4,type:'VEC4'})-1;}
    const reports=[];
    for(const name of OMITTED_FITTED_PERFORMANCE_CLIPS){
        const clip=json.animations.find(c=>c.name===name);assert.ok(clip,`${name}: missing bank clip`);
        assert.ok(!clip.channels.some(c=>pairs.some(p=>p.node===c.target.node)),`${name}: fitted performance already authored`);
        const channels=[];
        for(const pair of pairs){
            const originals=clip.channels.filter(c=>c.target.node===pair.legacy);
            for(const channel of originals){
                assert.equal(channel.target.path,'rotation',`${name}/${pair.name}: translation/scale needs explicit retargeting`);
                const sampler=clip.samplers[channel.sampler],accessor=await readStudioAccessor(json,bin,sampler.output);
                assert.equal(accessor.width,4);assert.ok(['LINEAR','CUBICSPLINE','STEP',undefined].includes(sampler.interpolation));
                const values=Float32Array.from(accessor.values),q=new Quaternion();
                for(let i=0;i<values.length;i+=4){q.fromArray(values,i).premultiply(pair.left).multiply(pair.right).toArray(values,i);}
                assert.ok(Array.from(values).every(Number.isFinite),'Nonfinite retargeted quaternion');
                const output=append(values),index=clip.samplers.push({...sampler,output})-1;
                clip.channels.push({sampler:index,target:{node:pair.node,path:'rotation'}});
                channels.push({originalNode:pair.legacy,fittedNode:pair.node,name:pair.name,originalInput:sampler.input,interpolation:sampler.interpolation??'LINEAR',left:pair.left.toArray(),right:pair.right.toArray()});
            }
        }
        reports.push({name,retargetedChannels:channels,poseWithoutOriginalLimbTrack:'Retain fitted bind pose under the existing animated torso; no invented leg movement.'});
    }
    json.extras??={};json.extras.fittedLimbPerformanceRepair={revision:'20261018-authored-omitted-clips-v1',sourceSha256,method:'Constant bind-frame quaternion delta retarget, including cubic derivatives and original sample times; all existing curves and skin streams retained.',clips:reports};
    json.buffers[0].byteLength=align4(binary.length);
    const packed=parseStudioGlb(compactGlbDelivery(encodeStudioGlb(json,binary)));
    // Later animation authoring must retain the newly restored performances.
    packed.json.extras.properAnimationSourceBoundary={binLength:packed.bin.length,accessorCount:packed.json.accessors.length,bufferViewCount:packed.json.bufferViews.length};
    const out=encodeStudioGlb(packed.json,packed.bin);return{bytes:out,report:{sourceSha256,sha256:sha(out),...json.extras.fittedLimbPerformanceRepair}};
}
