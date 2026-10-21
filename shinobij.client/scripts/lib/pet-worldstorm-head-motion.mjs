import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {Quaternion} from 'three';
import {parseStudioGlb,encodeStudioGlb,align4} from './pet-studio-glb.mjs';
import {readCharacterTake,sampleChannel} from './pet-character-motion.mjs';
import {compactGlbDelivery} from '../compact-glb-delivery.mjs';

const INPUTS=new Set([
    'fa0f43712bc768a60be9bac2de985d8d66b7ea6aed7e15ba8d856f7fffe7ef19',
    'c5c0710e6a08a71adf0552aaceaf1ac6da67461db5dcf581bfc0d40ab335b702',
]);

/** Keep the sculpt rigid while moderating the extreme upward action pose that
 * foreshortens the muzzle and hides the horns in the companion front view. */
export async function repairWorldstormDragonHeadMotion(bytes){
    const sourceSha256=createHash('sha256').update(bytes).digest('hex');
    assert.ok(INPUTS.has(sourceSha256),'Unexpected Worldstorm Dragon head-motion source');
    const {json,bin}=parseStudioGlb(bytes),idle=await readCharacterTake(json,bin,json.animations.find(c=>c.name==='idle'));
    let binary=bin;
    function append(array,width,type){
        const data=Buffer.from(array.buffer,array.byteOffset,array.byteLength),offset=align4(binary.length);
        binary=Buffer.concat([binary,Buffer.alloc(offset-binary.length),data]);
        const bufferView=json.bufferViews.push({buffer:0,byteOffset:offset,byteLength:data.length})-1;
        return json.accessors.push({bufferView,componentType:5126,count:array.length/width,type})-1;
    }
    const changes=[];
    for(const name of ['attack','cast','idle_hitreact1']){
        const clip=json.animations.find(c=>c.name===name),take=await readCharacterTake(json,bin,clip);
        const times=Float32Array.from({length:121},(_,i)=>take.duration*i/120);
        for(const bone of ['head','neck']){
            const node=json.nodes.findIndex(n=>n.name===bone),idleChannel=idle.channels.find(c=>c.node===node&&c.path==='rotation');
            const actionChannel=take.channels.find(c=>c.node===node&&c.path==='rotation');
            assert.ok(idleChannel&&actionChannel,`${name}/${bone}: missing original motion`);
            const neutral=new Quaternion().fromArray(sampleChannel(idleChannel,0)),values=[];
            for(const time of times){
                const authored=new Quaternion().fromArray(sampleChannel(actionChannel,time/take.duration));
                const q=neutral.clone().slerp(authored,.35).normalize();
                if(values.length&&q.dot(new Quaternion().fromArray(values,values.length-4))<0)q.set(-q.x,-q.y,-q.z,-q.w);
                values.push(...q.toArray());
            }
            const input=append(times,1,'SCALAR');json.accessors[input].min=[0];json.accessors[input].max=[take.duration];
            const channel=clip.channels.find(c=>c.target.node===node&&c.target.path==='rotation');
            clip.samplers[channel.sampler]={input,output:append(Float32Array.from(values),4,'VEC4'),interpolation:'LINEAR'};
            changes.push({clip:name,bone,keys:times.length,authoredMotionFraction:.35});
        }
    }
    json.extras.headMotionPresentationRepair={revision:'20261021-worldstorm-head-motion-v1',sourceSha256,changes,
        diagnosis:'Rigid skull edges retain length. Extreme upward head pitch foreshortens the face and hides horns. Reduce head/neck rotation excursions toward neutral idle while retaining action motion, geometry, skin, and all other tracks.'};
    json.buffers[0].byteLength=align4(binary.length);
    const packed=parseStudioGlb(compactGlbDelivery(encodeStudioGlb(json,binary)));
    packed.json.extras.properAnimationSourceBoundary={binLength:packed.bin.length,accessorCount:packed.json.accessors.length,bufferViewCount:packed.json.bufferViews.length};
    const output=encodeStudioGlb(packed.json,packed.bin);
    return {bytes:output,report:{...json.extras.headMotionPresentationRepair,sha256:createHash('sha256').update(output).digest('hex')}};
}
