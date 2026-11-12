/** Offline full movement from the existing weighted quadruped source rig. */
import {THREE,actor,yaw,scene,camera,renderer,bind,pose,pads,sole as sourceSole,height,pixelsPerUnit as ppu,
    base,restYaw,legPairs,position,rotation,setWorldRotation,extendLeg,cell} from './bake.js';
import {createMovementAPI} from 'virtual:quadruped-movement-planner';
import {createWeightedPadReader} from './weighted-pad.js';

if(!window.creatureBakeConfig?.squareMap)throw Error('Full hound movement requires the square map projection');
const vertical=1/Math.hypot(1,.46),groundZ=1,projection={vertical,groundZ};
const q=Math.hypot(vertical,groundZ),half=cell/(2*ppu),aim=new THREE.Vector3(0,height*.41,0);
Object.assign(camera,{left:-half,right:half,top:half/q,bottom:-half/q});
camera.position.copy(aim).add(new THREE.Vector3(0,groundZ,vertical).normalize().multiplyScalar(height*5));
camera.lookAt(aim);camera.updateProjectionMatrix();camera.updateMatrixWorld();
const groundPoint=new THREE.Vector3().project(camera),ground=(1-groundPoint.y)*cell/2;
const axisY=new THREE.Vector3(0,1,0),count=256,profiles=new Map(),cache=new Map();
const readers=new Map(pads.map(vertices=>[vertices,createWeightedPadReader(vertices)]));
const sole=vertices=>readers.get(vertices)();
for(const [clip,phase] of [['idle',0],['walk',.25],['gallop',.75]]){
    pose(clip,phase);
    for(const vertices of pads){
        const original=new THREE.Vector3(...sourceSole(vertices)),accelerated=new THREE.Vector3(...sole(vertices));
        if(original.distanceTo(accelerated)>1e-8)throw Error('Cached bone matrices changed the weighted pad measurement');
    }
}
const wrap=value=>(value%1+1)%1;
function heading(angle){
    yaw.rotation.y=angle-restYaw;
    yaw.position.copy(base).applyAxisAngle(axisY,yaw.rotation.y).multiplyScalar(-1);
    yaw.updateMatrixWorld(true);
}
function channels(){
    return bind.flatMap(([node])=>[...node.position,...node.quaternion,...node.scale]);
}
function restore(values){
    bind.forEach(([node],i)=>{
        const start=i*10;
        node.position.fromArray(values,start);node.quaternion.fromArray(values,start+3).normalize();
        node.scale.fromArray(values,start+7);
    });
    yaw.updateMatrixWorld(true);
}
function authored(gait,phase){
    heading(0);pose(gait==='run'?'gallop':gait,phase);
    if(gait!=='idle'){
        const pelvis=actor.getObjectByName('pelvis'),point=position(pelvis);
        point.y-=(gait==='run'?3:1.3)/ppu;
        pelvis.position.copy(pelvis.parent.worldToLocal(point));yaw.updateMatrixWorld(true);
    }
    // Quaternion signs are equivalent rotations; a common hemisphere prevents
    // interpolating across a spurious antipodal sign change in a source track.
    for(const [node] of bind)if(node.quaternion.w<0)node.quaternion.set(-node.quaternion.x,-node.quaternion.y,-node.quaternion.z,-node.quaternion.w);
    return {channels:channels(),toes:pads.map(sole)};
}
function cyclicCorrection(values,loaded,stride){
    const result=Array(count).fill(null);
    for(let i=0;i<count;i++){
        if(!loaded[i]||loaded[(i+count-1)%count])continue;
        const indices=[];for(let k=0;k<count&&loaded[(i+k)%count];k++)indices.push((i+k)%count);
        const anchor=indices.reduce((sum,n,k)=>sum+values[n]+k*stride/count,0)/indices.length;
        indices.forEach((n,k)=>{result[n]=anchor-values[n]-k*stride/count;});
    }
    if(result.every(value=>value===null))throw Error('No bounded hound contact');
    return result.map((value,i)=>{
        if(value!==null)return value;
        let a=1,b=1;while(result[(i-a+count)%count]===null)a++;while(result[(i+b)%count]===null)b++;
        const t=a/(a+b),u=t*t*(3-2*t);
        return result[(i-a+count)%count]*(1-u)+result[(i+b)%count]*u;
    });
}
for(const gait of ['idle','walk','run']){
    const raw=Array.from({length:count},(_,i)=>authored(gait,i/count));
    const stride=gait==='run'?49.4:gait==='walk'?21.32:0;
    const tracks=pads.map((_,paw)=>{
        const points=raw.map(state=>state.toes[paw]),floor=Math.min(...points.map(point=>point[1]));
        const loaded=points.map(point=>(point[1]-floor)*ppu<.65);
        const z=points.map(point=>point[2]*ppu),x=points.map(point=>point[0]*ppu);
        return {floor,loaded,xCorrection:gait==='idle'?Array(count).fill(0):cyclicCorrection(x,loaded,0),
            zCorrection:gait==='idle'?Array(count).fill(0):cyclicCorrection(z,loaded,stride)};
    });
    profiles.set(gait,{raw,tracks,period:gait==='idle'?2.4:stride/(gait==='run'?120:31)});
}
heading(0);pose('idle',0);
const padAngles=legPairs.map(pair=>pair.map(chain=>rotation(chain.pad)));
function sample(view,gait,phase){
    const key=[view,gait,Math.round(wrap(phase)*1e10)].join('/');if(cache.has(key))return structuredClone(cache.get(key));
    const profile=profiles.get(gait),phaseIndex=wrap(phase)*count,index=Math.floor(phaseIndex),next=(index+1)%count,t=phaseIndex-index;
    const state=authored(gait,wrap(phase)),angle=view*Math.PI/4;
    const contacts=[],toes=state.toes.map((point,paw)=>{
        const track=profile.tracks[paw],loaded=gait==='idle'||track.loaded[index]&&track.loaded[next];contacts.push(loaded);
        const offset=(values)=>values[index]*(1-t)+values[next]*t;
        const adjusted=new THREE.Vector3(point[0]+offset(track.xCorrection)/ppu,
            loaded?0:Math.max(0,point[1]-track.floor),point[2]+offset(track.zCorrection)/ppu);
        return adjusted.applyAxisAngle(axisY,angle).toArray();
    });
    const result={view,angle,hipY:0,leanAmount:0,armSwings:state.channels,toes,contacts,
        footYaw:toes.map(()=>angle),footPitches:toes.map(()=>0),limbViews:toes.map(()=>view)};
    cache.set(key,result);return structuredClone(result);
}
function draw(state){
    restore(state.armSwings);heading(state.angle);
    if(state.hipY){
        yaw.position.y+=state.hipY;yaw.updateMatrixWorld(true);
    }
    for(let paw=0;paw<pads.length;paw++){
        const bearing=new THREE.Quaternion().setFromAxisAngle(axisY,state.footYaw[paw]);
        legPairs[paw].forEach((chain,j)=>setWorldRotation(chain.pad,bearing.clone().multiply(padAngles[paw][j])));
    }
    // Find the whole-body compression needed by all four fixed-length chains.
    // Keep a small knee bend instead of stretching a leg to meet its footprint.
    let totalCompression=0;
    for(let pass=0;pass<4;pass++){
        let low=-Infinity,high=Infinity;
        for(let paw=0;paw<pads.length;paw++){
            const delta=new THREE.Vector3(...state.toes[paw]).sub(new THREE.Vector3(...sole(pads[paw])));
            for(const {hip,knee,pad} of legPairs[paw]){
                const a=position(hip),b=position(knee),goal=position(pad).add(delta);
                const upper=a.distanceTo(b),lower=b.distanceTo(position(pad));
                const length=(upper+lower)*.995,minimum=Math.abs(upper-lower)+.0001;
                const horizontal=Math.hypot(goal.x-a.x,goal.z-a.z);
                if(horizontal>=length)throw Error('Hound footprint exceeds horizontal reach');
                const capacity=Math.sqrt(length*length-horizontal*horizontal);
                low=Math.max(low,goal.y-a.y-capacity+.012);
                high=Math.min(high,goal.y-a.y+capacity-.012);
                // A two-link leg also has a minimum folded reach. A compact
                // recovery can require lifting the body slightly, rather than
                // compressing it further and forcing the paw into the shin.
                if(horizontal<minimum)low=Math.max(low,goal.y-a.y+Math.sqrt(minimum*minimum-horizontal*horizontal)+.001);
            }
        }
        if(low>high+1e-8)throw Error('Hound footprints have no shared fixed-length body height');
        const compression=Math.max(low,Math.min(0,high));
        totalCompression+=compression;
        if(Math.abs(totalCompression)>.14)throw Error('Hound transition requires excessive whole-body displacement');
        yaw.position.y+=compression;yaw.updateMatrixWorld(true);
        for(let paw=0;paw<pads.length;paw++){
            const target=new THREE.Vector3(...state.toes[paw]);
            for(let iteration=0;iteration<12;iteration++){
                const delta=target.clone().sub(new THREE.Vector3(...sole(pads[paw])));
                if(delta.length()*ppu<.001)break;
                for(const chain of legPairs[paw])extendLeg(chain,delta.clone());
            }
        }
        const error=Math.max(...pads.map((vertices,paw)=>new THREE.Vector3(...sole(vertices)).distanceTo(new THREE.Vector3(...state.toes[paw]))*ppu));
        if(error<=.05)break;
        if(pass===3)throw Error('Hound weighted paws cannot reach their footprints: '+JSON.stringify({error,totalCompression,
            residuals:pads.map((vertices,paw)=>sole(vertices).map((value,j)=>(value-state.toes[paw][j])*ppu)),
            scales:legPairs.map(pair=>pair.map(({hip,knee,pad})=>[hip,knee,pad].map(node=>node.getWorldScale(new THREE.Vector3()).toArray())))}));
    }
    const actual=pads.map(sole);
    if(!state.sampleOnly)renderer.render(scene,camera);
    return {pads:actual,loaded:state.contacts};
}
window.paintedMovement=createMovementAPI({cell,ground,renderer,ppu,projection,period:gait=>profiles.get(gait).period,
    sample,draw,pivotCrouch:.025,changeCrouch:.025,startCrouch:.03,stopCrouch:.03,pivotStepAngle:Math.PI/4});
window.clawedBake=(view,gait,frames)=>{
    const atlas=document.createElement('canvas'),cols=Math.min(frames,8),joints=[],contacts=[];
    atlas.width=cols*cell;atlas.height=Math.ceil(frames/cols)*cell;const ctx=atlas.getContext('2d');
    for(let i=0;i<frames;i++){
        const result=draw(sample(view,gait,i/frames));joints.push(result.pads);contacts.push(result.loaded);
        ctx.drawImage(renderer.domElement,i%cols*cell,Math.floor(i/cols)*cell,cell,cell);
    }
    return {data:atlas.toDataURL('image/png').split(',')[1],cell,cols,count:frames,origin:[cell/2,ground],
        period:profiles.get(gait).period,speed:gait==='walk'?31:gait==='run'?120:0,
        joints,contacts,pixelsPerUnit:ppu,projection,padVertices:pads.map(pad=>pad.length)};
};
