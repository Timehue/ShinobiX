import {createHash} from 'node:crypto';
import {Quaternion,Vector3} from 'three';
import {parseStudioGlb,encodeStudioGlb,readStudioAccessor,align4} from './pet-studio-glb.mjs';
import {readCharacterTake} from './pet-character-motion.mjs';
import {compactGlbDelivery} from '../compact-glb-delivery.mjs';

// These small, constant tail-root tilts preserve each authored tail curve and
// its cubic tangents, while clearing the independently selected visible tail.
// The body, feet, other joints and defeat pose keep their original tracks.
export async function repairFrostWyrmTailClearance(bytes) {
    const sourceSha256=createHash('sha256').update(bytes).digest('hex');
    if(sourceSha256!=='da3d2b929c446d1c800cf456d0978af67f0fc865a2d149ae1d37fbdc563ec558')throw Error('Unexpected Frost Wyrm face-repaired source');
    const {json,bin}=parseStudioGlb(bytes),node=json.nodes.findIndex(n=>n.name==='tail_1');
    if(node<0)throw Error('Expected Frost Wyrm tail root');
    const angles={idle:.035,idle_2:.325,walk:.17,gallop:.455,attack:.33,idle_hitreact1:.415,guard:.05,rest:.075,victory:.035};
    let binary=bin;
    function append(values,type){const offset=align4(binary.length),b=Buffer.from(values.buffer,values.byteOffset,values.byteLength);binary=Buffer.concat([binary,Buffer.alloc(offset-binary.length),b]);const view=json.bufferViews.push({buffer:0,byteOffset:offset,byteLength:b.length})-1;return json.accessors.push({bufferView:view,componentType:5126,count:values.length/(type==='VEC4'?4:1),type})-1;}
    const clips=[];
    for(const [name,angle]of Object.entries(angles)){
        const clip=json.animations.find(c=>c.name===name);if(!clip)throw Error('Expected reviewed Frost Wyrm clip '+name);
        const channels=clip.channels.filter(c=>c.target.node===node&&c.target.path==='rotation');if(channels.length>1)throw Error('Ambiguous tail root curve');
        const tilt=new Quaternion().setFromAxisAngle(new Vector3(1,0,0),angle);let sampler;
        if(channels.length){const prior=clip.samplers[channels[0].sampler];if(prior.interpolation!=='CUBICSPLINE')throw Error('Expected authored cubic tail curve');const {values,width}=await readStudioAccessor(json,bin,prior.output);if(width!==4)throw Error('Expected tail quaternion');for(let i=0;i<values.length;i+=4)new Quaternion().fromArray(values,i).multiply(tilt).toArray(values,i);sampler={...prior,output:append(values,'VEC4')};clip.samplers[channels[0].sampler]=sampler;}
        else{const take=await readCharacterTake(json,bin,clip),times=Float32Array.from([0,take.duration]),q=new Quaternion().fromArray(json.nodes[node].rotation??[0,0,0,1]).multiply(tilt),values=new Float32Array(24);q.toArray(values,4);q.toArray(values,16);const input=append(times,'SCALAR');json.accessors[input].min=[0];json.accessors[input].max=[take.duration];sampler={input,output:append(values,'VEC4'),interpolation:'CUBICSPLINE'};clip.samplers.push(sampler);clip.channels.push({sampler:clip.samplers.length-1,target:{node,path:'rotation'}});}
        clips.push({name,angleRadians:angle,changedTracks:1,existingCurvePreservedByConstantQuaternionComposition:channels.length===1});
    }
    const report={revision:'20261017-frost-wyrm-tail-clearance-v1',sourceSha256,bone:'tail_1',clips};json.extras.frostWyrmTailClearance=report;json.buffers[0].byteLength=align4(binary.length);
    return {bytes:compactGlbDelivery(encodeStudioGlb(json,binary)),report};
}
