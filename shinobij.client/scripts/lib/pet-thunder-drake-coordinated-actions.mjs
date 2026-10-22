import {createHash} from 'node:crypto';
import {Quaternion,Euler,Vector3,Matrix4} from 'three';
import {parseStudioGlb,encodeStudioGlb,align4} from './pet-studio-glb.mjs';
import {createCharacterRig,readCharacterTake,sampleChannel,solveFoot} from './pet-character-motion.mjs';
import {studioTangents} from './pet-studio-curves.mjs';
import {compactGlbDelivery} from '../compact-glb-delivery.mjs';

/** Coordinate Thunder Drake's attack, cast and recoil. Preserve its sculpt, skin, face
 * tracks, gait, idle and other authored performances exactly. */
export async function repairThunderDrakeCoordinatedActions(bytes) {
    const sourceSha256=createHash('sha256').update(bytes).digest('hex');
    if(sourceSha256!=='f7b0d941130147542e9d0fb45243785557fd73b0af2c22c2b9ed8b00f8c36eb8')throw Error('Unexpected Thunder Drake source');
    const {json,bin}=parseStudioGlb(bytes),rig=createCharacterRig(json);
    // This dragon uses the biped bone names for its four-legged sculpt.
    // Add the two forelimb chains locally; leave every other pet's rig unchanged.
    if(rig.chains.length!==2)throw Error('Expected two hind-leg chains');
    rig.chains.forEach(c=>{c.kind='quadruped';c.part='hind';});
    for(const side of ['L','R']){
        const ids=['upper_arm.','forearm.','hand.'].map(prefix=>rig.byName.get(prefix+side));
        if(ids.some(i=>i===undefined))throw Error('Missing dragon forelimb chain');
        const [a,b,c]=ids.map(i=>rig.nodes[i]),frame=rig.nodes[rig.byName.get('root')].parent;
        if(b.parent!==a||c.parent!==b)throw Error('Disconnected dragon forelimb');
        const inv=new Matrix4().copy(frame.matrixWorld).invert(),pos=n=>new Vector3().setFromMatrixPosition(new Matrix4().copy(inv).multiply(n.matrixWorld));
        const A=pos(a),B=pos(b),C=pos(c),direction=C.clone().sub(A).normalize(),pole=B.clone().sub(A);pole.addScaledVector(direction,-pole.dot(direction));
        if(pole.lengthSq()<1e-8)pole.set(0,0,1).addScaledVector(direction,-direction.z);
        const orientation=new Quaternion();new Matrix4().copy(inv).multiply(c.matrixWorld).decompose(new Vector3(),orientation,new Vector3());
        rig.chains.push({ids,kind:'quadruped',side,part:'front',frame,up:new Vector3(0,1,0).transformDirection(inv),forward:new Vector3(0,0,1).transformDirection(inv),length:A.distanceTo(B)+B.distanceTo(C),origin:C,orientation,pole:pole.normalize()});
    }

    const idle=await readCharacterTake(json,bin,json.animations.find(c=>c.name==='idle'));
    const rootId=rig.byName.get('root'),spineId=rig.byName.get('spine');
    const idleSpine=idle.channels.find(c=>c.node===spineId&&c.path==='rotation');
    const smooth=t=>{t=Math.max(0,Math.min(1,t));return t*t*(3-2*t);};
    const pulse=(p,a,b,c)=>p<b?smooth((p-a)/(b-a)):1-smooth((p-b)/(c-b));
    let binary=bin;
    function append(values,type){
        const offset=align4(binary.length),b=Buffer.from(values.buffer,values.byteOffset,values.byteLength);
        binary=Buffer.concat([binary,Buffer.alloc(offset-binary.length),b]);
        const view=json.bufferViews.push({buffer:0,byteOffset:offset,byteLength:b.length})-1;
        return json.accessors.push({bufferView:view,componentType:5126,count:values.length/(type==='VEC4'?4:type==='VEC3'?3:1),type})-1;
    }
    const reports=[];
    for(const name of ['attack','cast','idle_hitreact1']){
        const clip=json.animations.find(c=>c.name===name),take=await readCharacterTake(json,bin,clip);
        const times=Float32Array.from({length:49},(_,i)=>i/48*take.duration),streams=new Map(),contacts=[];
        const remember=(node,path)=>streams.set(`${node}:${path}`,{node,path,values:[]});
        remember(rootId,'translation');remember(spineId,'rotation');
        for(const bone of ['chest','pelvis'])remember(rig.byName.get(bone),'rotation');
        rig.chains.forEach(c=>c.ids.forEach(id=>remember(id,'rotation')));
        for(const time of times){
            const p=time/take.duration;rig.reset();
            for(const c of take.channels){const v=sampleChannel(c,p),n=rig.nodes[c.node];if(c.path==='rotation')n.quaternion.fromArray(v);else if(c.path==='translation')n.position.fromArray(v);else n.scale.fromArray(v);}
            for(const bone of ['chest','pelvis']){const id=rig.byName.get(bone);rig.nodes[id].quaternion.copy(rig.bind[id].q);}
            const crouch=pulse(p,0,.28,.68),drive=pulse(p,.28,.48,.9),impact=pulse(p,0,.18,.78);
            const recoil=name==='idle_hitreact1',cast=name==='cast',settle=rig.chains[0].length*.035;
            rig.nodes[rootId].position.copy(rig.bind[rootId].p)
                .addScaledVector(rig.chains[0].up,-settle-(recoil?.014*impact:.018*crouch))
                .addScaledVector(rig.chains[0].forward,recoil?-.018*impact:cast?-.008*crouch:-.012*crouch+.026*drive);
            rig.nodes[spineId].quaternion.fromArray(idleSpine?sampleChannel(idleSpine,0):rig.bind[spineId].q.toArray()).multiply(new Quaternion().setFromEuler(new Euler(
                recoil?-.045*impact:cast?-.045*crouch+.025*drive:-.035*crouch+.045*drive,0,recoil?.025*impact:0)));
            // Solve upper leg, knee and paw as one chain. Techniques keep three
            // support paws down; casting and recoil keep all four grounded.
            for(const chain of rig.chains){
                for(const id of chain.ids)rig.nodes[id].quaternion.copy(rig.bind[id].q);
                const swipe=name==='attack'&&chain.part==='front'&&chain.side==='L';
                const lift=swipe?.055*pulse(p,.10,.34,.76):0,reach=swipe?.075*pulse(p,.20,.48,.85):0;
                const target=chain.origin.clone().addScaledVector(chain.up,lift).addScaledVector(chain.forward,reach);
                const error=solveFoot(rig,chain,target,chain.orientation);
                contacts.push({p,foot:rig.nodes[chain.ids[2]].name,error,planted:!swipe||lift===0});
            }
            for(const s of streams.values()){const n=rig.nodes[s.node];s.values.push(...(s.path==='rotation'?n.quaternion.toArray():n.position.toArray()));}
        }
        const inputAccessor=append(times,'SCALAR');json.accessors[inputAccessor].min=[0];json.accessors[inputAccessor].max=[take.duration];
        for(const s of streams.values()){
            const width=s.path==='rotation'?4:3,values=Float32Array.from(s.values);
            if(width===4)for(let i=1;i<times.length;i++){let dot=0;for(let k=0;k<4;k++)dot+=values[(i-1)*4+k]*values[i*4+k];if(dot<0)for(let k=0;k<4;k++)values[i*4+k]*=-1;}
            const tangents=studioTangents(times,values,width,false),spline=new Float32Array(times.length*width*3);
            for(let i=0;i<times.length;i++)for(let k=0;k<width;k++){spline[i*width*3+k]=spline[i*width*3+width*2+k]=tangents[i*width+k];spline[i*width*3+width+k]=values[i*width+k];}
            const sampler={input:inputAccessor,output:append(spline,width===4?'VEC4':'VEC3'),interpolation:'CUBICSPLINE'},prior=clip.channels.find(c=>c.target.node===s.node&&c.target.path===s.path);
            if(prior)clip.samplers[prior.sampler]=sampler;else{clip.samplers.push(sampler);clip.channels.push({sampler:clip.samplers.length-1,target:{node:s.node,path:s.path}});}
        }
        const report={name,keys:times.length,changedTracks:streams.size,maxContactError:Math.max(...contacts.filter(c=>c.planted).map(c=>c.error)),contacts};
        if(report.maxContactError>.0001)throw Error(`Unreachable paw ${name}/${report.maxContactError}`);
        reports.push(report);
        json.extras.characterMotion.clips=json.extras.characterMotion.clips.filter(c=>c.name!==name);
        json.extras.characterMotion.clips.push({name,contacts:contacts.filter(c=>c.planted).length,keys:times.length,tracks:streams.size,cyclic:false,maxContactErrorNormalized:report.maxContactError/rig.chains[0].length});
    }
    json.buffers[0].byteLength=align4(binary.length);
    const report={revision:'20261017-thunder-drake-coordinated-actions-v1',sourceSha256,clips:reports};
    json.extras.coordinatedActionRepair={...report,clips:reports.map(({contacts,...r})=>({...r,contacts:contacts.filter(c=>c.planted).length}))};
    json.extras.characterMotion.plantedAttack=true;
    json.extras.characterMotion.plantedRecoil=true;
    return {bytes:compactGlbDelivery(encodeStudioGlb(json,binary)),report};
}
