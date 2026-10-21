import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import * as T from 'three';
import {parseStudioGlb,encodeStudioGlb,align4} from './pet-studio-glb.mjs';
import {loadPetDeformationProbeBytes,snapshotPetPose} from './pet-deformation-probe.mjs';
import {compactGlbDelivery} from '../compact-glb-delivery.mjs';

const INPUTS=new Set(['29fe007d1943642b97042072c25a4d7a0fcd5b2be1f28ad0e7dd71971bb17692','f05d82acdcdb171167788a6709b05f4e161888107792a3f3cf5edc0a8c709fa8']);
const smooth=(a,b,x)=>{const t=T.MathUtils.clamp((x-a)/(b-a),0,1);return t*t*(3-2*t);};

/** Author a terminal collapse instead of the old death take returning upright.
 * The whole connected rig falls forward onto its flank; head, tail and limb
 * animation remains, and root height follows the actual visible mesh floor. */
export async function repairAzureRyujinDeathPose(bytes){
    const sourceSha256=createHash('sha256').update(bytes).digest('hex');
    assert.ok(INPUTS.has(sourceSha256),'Unexpected Azure Ryujin death-pose source');
    const m=await loadPetDeformationProbeBytes(bytes),mesh=m.meshes[0],root=mesh.skeleton.bones.find(b=>b.name==='root');
    const restore=snapshotPetPose(m.scene),mixer=new T.AnimationMixer(m.scene),clip=m.animations.find(c=>c.name==='death');
    const {json,bin}=parseStudioGlb(bytes),target=json.animations.find(c=>c.name==='death'),node=json.nodes.findIndex(n=>n.name==='root');
    const vertex=new T.Vector3(),floor=()=>{let min=Infinity;for(const mesh of m.meshes)for(let v=0;v<mesh.geometry.attributes.position.count;v++)min=Math.min(min,mesh.getVertexPosition(v,vertex).applyMatrix4(mesh.matrixWorld).y);return min;};
    const ground=floor(),times=Float32Array.from({length:121},(_,i)=>clip.duration*i/120),rotations=[],positions=[];
    for(const [i,time]of times.entries()){
        mixer.stopAllAction();restore();const action=mixer.clipAction(clip).reset().setLoop(T.LoopOnce,1);action.clampWhenFinished=true;action.play();action.time=time;mixer.update(0);m.update();
        const phase=i/120,fall=smooth(.12,.72,phase),settle=Math.sin(T.MathUtils.clamp((phase-.72)/.18,0,1)*Math.PI)*.025;
        const world=root.getWorldQuaternion(new T.Quaternion()),parent=root.parent.getWorldQuaternion(new T.Quaternion());
        const roll=new T.Quaternion().setFromAxisAngle(new T.Vector3(1,0,.2).normalize(),fall*(Math.PI*.47)-settle);
        root.quaternion.copy(parent.invert().multiply(roll.multiply(world))).normalize();root.position.x-=.08*fall;m.update();
        const shift=ground+.0005-floor(),worldPosition=root.getWorldPosition(new T.Vector3());worldPosition.y+=shift;
        root.position.copy(root.parent.worldToLocal(worldPosition));m.update();
        const q=root.quaternion.clone();if(rotations.length&&q.dot(new T.Quaternion().fromArray(rotations,rotations.length-4))<0)q.set(-q.x,-q.y,-q.z,-q.w);
        rotations.push(...q.toArray());positions.push(...root.position.toArray());
    }
    let binary=bin;
    function append(array,width,type){const data=Buffer.from(array.buffer,array.byteOffset,array.byteLength),offset=align4(binary.length);binary=Buffer.concat([binary,Buffer.alloc(offset-binary.length),data]);const bufferView=json.bufferViews.push({buffer:0,byteOffset:offset,byteLength:data.length})-1;return json.accessors.push({bufferView,componentType:5126,count:array.length/width,type})-1;}
    const input=append(times,1,'SCALAR');json.accessors[input].min=[0];json.accessors[input].max=[clip.duration];
    for(const [path,values,width,type]of [['rotation',rotations,4,'VEC4'],['translation',positions,3,'VEC3']]){
        const sampler={input,output:append(Float32Array.from(values),width,type),interpolation:'LINEAR'},channel=target.channels.find(c=>c.target.node===node&&c.target.path===path);
        if(channel)target.samplers[channel.sampler]=sampler;else{target.samplers.push(sampler);target.channels.push({sampler:target.samplers.length-1,target:{node,path}});}
    }
    json.extras.deathPoseRepair={revision:'20261021-azure-terminal-collapse-v3',sourceSha256,clip:'death',keys:times.length,terminalRollDegrees:84.6,worldAxis:[1,0,.2],ground,clearance:.0005,changedTracks:['root.rotation','root.translation'],geometrySkinOtherTracksRetained:true};
    json.buffers[0].byteLength=align4(binary.length);const packed=parseStudioGlb(compactGlbDelivery(encodeStudioGlb(json,binary)));
    packed.json.extras.properAnimationSourceBoundary={binLength:packed.bin.length,accessorCount:packed.json.accessors.length,bufferViewCount:packed.json.bufferViews.length};
    const output=encodeStudioGlb(packed.json,packed.bin);return {bytes:output,report:{...json.extras.deathPoseRepair,sha256:createHash('sha256').update(output).digest('hex')}};
}
