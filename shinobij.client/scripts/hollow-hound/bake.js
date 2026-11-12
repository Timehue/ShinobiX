import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

const cell = window.creatureBakeConfig?.squareMap ? 192 : 144, oversample = 2;
// Offline roster review can supply another source-bound quadruped. The default
// encounter bake keeps its original model and portrait palette.
const creature = window.creatureBakeConfig;
if (creature && (!/^\/.ci-evidence\/roster-creatures\/[a-z0-9-]+\.glb$/.test(creature.model)
    || !Number.isFinite(creature.materialGain) || creature.materialGain < 1 || creature.materialGain > 3
    || !Number.isFinite(creature.fill) || creature.fill < 0 || creature.fill > .3)) {
    throw new Error('Invalid offline creature review configuration');
}
await MeshoptDecoder.ready;
const { scene: actor, animations } = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(creature?.model ?? '/pet-models/roster/mythic-4.glb');
const yaw = new THREE.Group();
yaw.add(actor);
const scene = new THREE.Scene();
scene.add(yaw, new THREE.HemisphereLight(0xfff4ee, 0x76889c, 1.7));
const sun = new THREE.DirectionalLight(0xffefdd, 2.0);
sun.position.set(-3, 6, 4);
scene.add(sun);
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, .01, 1000);
const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
renderer.setSize(cell * oversample, cell * oversample);
renderer.setClearColor(0, 0);
const mixer = new THREE.AnimationMixer(actor);
const bind = [];
actor.traverse(node => bind.push([node, node.position.clone(), node.quaternion.clone(), node.scale.clone()]));
function pose(name, phase) {
    mixer.stopAllAction();
    for (const [node, pos, rotation, scale] of bind) {
        node.position.copy(pos);
        node.quaternion.copy(rotation);
        node.scale.copy(scale);
    }
    const clip = animations.find(value => value.name === name);
    const action = mixer.clipAction(clip).reset().play();
    action.time = phase * clip.duration;
    mixer.update(0);
    yaw.updateMatrixWorld(true);
    return clip.duration;
}
function joint(name) {
    const bone = actor.getObjectByName(name) ?? actor.getObjectByName(name.replaceAll('.', ''));
    if (!bone) throw new Error('Missing rig joint '+name);
    return bone.getWorldPosition(new THREE.Vector3());
}
const paws = ['front','hind'].flatMap(pair => ['L','R'].map(side => 'legacy_'+pair+'_paw.'+side));
pose('idle', 0);
const restPaws = paws.map(joint);
const center = restPaws.reduce((v,p) => v.add(p), new THREE.Vector3()).multiplyScalar(.25);
const forward = restPaws[0].clone().add(restPaws[1]).sub(restPaws[2]).sub(restPaws[3]);
const restYaw = Math.atan2(forward.x, forward.z);
const mesh = [];
actor.traverse(node => { if (node.isSkinnedMesh) mesh.push(node); });
if (!mesh.length) throw new Error('Missing skinned hound');
const bound = new THREE.Box3().makeEmpty();
for (const node of mesh) {
    node.computeBoundingBox();
    bound.union(node.boundingBox.clone().applyMatrix4(node.matrixWorld));
}
const height = bound.max.y-bound.min.y;
// Track the actual paw pads. The file has two generations of leg bones, and
// an animated joint with no influence on the mesh cannot define a footprint.
const pads=paws.map(()=>[]);
for(const node of mesh){
    const joints=node.geometry.attributes.skinIndex, weights=node.geometry.attributes.skinWeight;
    for(let vertex=0;vertex<joints.count;vertex++){
        const influence=[0,0,0,0];
        for(let k=0;k<4;k++){
            const name=node.skeleton.bones[joints.getComponent(vertex,k)].name.replace(/^legacy_/,'').replaceAll('.','');
            const side=paws.findIndex(p=>p.replace(/^legacy_/,'').replaceAll('.','')===name);
            if(side>=0) influence[side]+=weights.getComponent(vertex,k);
        }
        const best=Math.max(...influence);
        if(best<.28)continue;
        const p=node.getVertexPosition(vertex,new THREE.Vector3()).applyMatrix4(node.matrixWorld);
        pads[influence.indexOf(best)].push({node,vertex,y:p.y});
    }
}
for(let i=0;i<pads.length;i++){
    const list=pads[i].sort((a,b)=>a.y-b.y);
    if(list.length<5)throw new Error('Missing weighted paw pad '+paws[i]);
    pads[i]=list.filter(v=>v.y<list[0].y+.035*height);
}
function sole(vertices) {
    const samples=vertices.map(({node,vertex})=>node.getVertexPosition(vertex,new THREE.Vector3()).applyMatrix4(node.matrixWorld));
    samples.sort((a,b)=>a.y-b.y);
    const active=samples.slice(0,Math.max(1,Math.ceil(samples.length*.25)));
    return active.reduce((v,p)=>v.add(p),new THREE.Vector3()).multiplyScalar(1/active.length).toArray();
}
const pixelsPerUnit = 73.44 / height;
const half = cell/(2*pixelsPerUnit);
Object.assign(camera, {left:-half,right:half,top:half,bottom:-half});
camera.updateProjectionMatrix();
const aim = new THREE.Vector3(0, height*.41, 0);
camera.position.copy(aim).add(new THREE.Vector3(0,.46,1).normalize().multiplyScalar(height*5));
camera.lookAt(aim);
camera.updateMatrixWorld();
const base = center.clone();
base.y = bound.min.y;
function groundPoint(point) {
    const p = point.clone().project(camera);
    return [(p.x+1)*cell/2,(1-p.y)*cell/2];
}
const origin = groundPoint(new THREE.Vector3());
// Build one shared void coat from the game's Hollow Hound painting. Keep the
// UV layout, original tonal details, rig weights and glow-mark placements.
const painting = creature && !creature.portraitPalette ? null : await createImageBitmap(await (await fetch('/hollow-gate/hollow-hound-idle.webp')).blob());
function pixels(image) {
    const c=document.createElement('canvas');
    c.width=image.width;c.height=image.height;
    const ctx=c.getContext('2d', {willReadFrequently:true});
    ctx.drawImage(image,0,0);
    return {c,ctx,data:ctx.getImageData(0,0,c.width,c.height)};
}
let palette = [];
if (painting) {
const paint = pixels(painting).data.data;
const swatches=[];
for(let i=0;i<paint.length;i+=16) {
    if (paint[i+3]>200) swatches.push([paint[i],paint[i+1],paint[i+2]]);
}
const lum = ([r,g,b]) => .2126*r+.7152*g+.0722*b;
swatches.sort((a,b)=>lum(a)-lum(b));
palette=[.04,.22,.50,.75,.91,.985,.998].map(q=> {
    const index=Math.round(q*(swatches.length-1));
    const near=swatches.slice(Math.max(0,index-40),index+41);
    return [0,1,2].map(c=>near.reduce((s,v)=>s+v[c],0)/near.length);
});
for(const node of mesh) {
    const {c,ctx,data}=pixels(node.material.map.image);
    for(let i=0;i<data.data.length;i+=4) {
        const [r,g,b]=data.data.subarray(i,i+3);
        const max=Math.max(r,g,b), min=Math.min(r,g,b);
        const light=lum([r,g,b])/255, chroma=(max-min)/255;
        const warmMark=Math.max(0,r-Math.max(g,b))/180;
        const eye=Math.min(1,Math.max(0,Math.min(r,g)-b)/55);
        const value=Math.min(1,.008+.59*light+.62*chroma+.65*warmMark+.90*eye);
        const k=value*(palette.length-1), a=Math.floor(k), z=Math.min(a+1,palette.length-1);
        for(let j=0;j<3;j++) data.data[i+j]=palette[a][j]+(k-a)*(palette[z][j]-palette[a][j]);
    }
    ctx.putImageData(data,0,0);
    const map=new THREE.CanvasTexture(c);
    map.flipY=node.material.map.flipY;
    map.colorSpace=THREE.SRGBColorSpace;
    node.material=node.material.clone();
    node.material.map=map;
    node.material.emissive.setRGB(.30,.20,.48);
    node.material.emissiveMap=map;
    node.material.onBeforeCompile=shader=>{
        shader.fragmentShader=shader.fragmentShader.replace('#include <opaque_fragment>',`
            float edgeGlow = pow(1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0), 3.0);
            outgoingLight += vec3(0.19, 0.042, 0.37) * edgeGlow;
            #include <opaque_fragment>`);
    };
    node.material.needsUpdate=true;
}
} else {
    for (const node of mesh) {
        node.material = node.material.clone();
        node.material.color.multiplyScalar(creature.materialGain);
        node.material.emissive.setRGB(creature.fill, creature.fill, creature.fill);
        node.material.emissiveMap = node.material.map;
        node.material.needsUpdate = true;
    }
}
const legPairs=paws.map(name=>[name,name.replace('legacy_','')].map(key=>{
    const pad=actor.getObjectByName(key.replaceAll('.',''));
    return {pad, knee:pad.parent, hip:pad.parent.parent};
}));
const position=node=>node.getWorldPosition(new THREE.Vector3());
const rotation=node=>node.getWorldQuaternion(new THREE.Quaternion());
function setWorldRotation(node,q){
    node.quaternion.copy(rotation(node.parent).invert().multiply(q));
    node.updateWorldMatrix(false,true);
}
function aimChild(node,child,goal){
    const pivot=position(node);
    const correction=new THREE.Quaternion().setFromUnitVectors(
        position(child).sub(pivot).normalize(),goal.clone().sub(pivot).normalize());
    setWorldRotation(node,correction.multiply(rotation(node)));
}
// Solve the authored two-link chain in its original bending plane. Keep the
// paw's source rotation so toe roll survives the longer ground stroke.
function extendLeg({hip,knee,pad},offset){
    const start=position(hip), middle=position(knee), end=position(pad);
    const pawAngle=rotation(pad);
    const a=middle.distanceTo(start), b=end.distanceTo(middle);
    const natural=end.clone().sub(start).normalize();
    const bend=middle.clone().sub(start);
    bend.addScaledVector(natural,-bend.dot(natural));
    if(bend.lengthSq()<1e-12)return;
    const direction=end.add(offset).sub(start);
    const reach=THREE.MathUtils.clamp(direction.length(),Math.abs(a-b)+1e-5,a+b-1e-5);
    direction.normalize();
    bend.addScaledVector(direction,-bend.dot(direction)).normalize();
    const along=(a*a-b*b+reach*reach)/(2*reach);
    const newKnee=start.clone().addScaledVector(direction,along)
        .addScaledVector(bend,Math.sqrt(Math.max(0,a*a-along*along)));
    aimChild(hip,knee,newKnee);
    aimChild(knee,pad,start.addScaledVector(direction,reach));
    setWorldRotation(pad,pawAngle);
}
// Keep each loaded paw over one floor point. Interpolate the small correction
// across swing so contact release, touchdown and the cycle seam stay continuous.
function contactCorrection(path,stride){
    const count=path.length, correction=Array(count).fill(null);
    const floor=Math.min(...path.map(p=>p.height));
    const loaded=path.map(p=>p.height<floor+.65);
    for(let i=0;i<count;i++){
        if(!loaded[i] || loaded[(i+count-1)%count])continue;
        const indices=[];
        for(let k=0;k<count && loaded[(i+k)%count];k++)indices.push((i+k)%count);
        const tracked=indices.map((n,k)=>path[n].reach+k*stride/count);
        const anchor=tracked.reduce((a,b)=>a+b,0)/tracked.length;
        indices.forEach((n,k)=>{correction[n]=anchor-tracked[k];});
    }
    if(correction.every(k=>k===null))throw new Error('Missing paw contact in gait');
    return correction.map((value,i)=>{
        if(value!==null)return value;
        let a=1,b=1;
        while(correction[(i-a+count)%count]===null)a++;
        while(correction[(i+b)%count]===null)b++;
        const linear=a/(a+b);
        const ease=linear*linear*(3-2*linear);
        return THREE.MathUtils.lerp(correction[(i-a+count)%count],correction[(i+b)%count],ease);
    });
}
window.bake = (view, clip, count) => {
    yaw.rotation.y=view*Math.PI/4-restYaw;
    yaw.position.copy(base).applyAxisAngle(new THREE.Vector3(0,1,0),yaw.rotation.y).multiplyScalar(-1);
    const atlas=document.createElement('canvas');
    const cols=Math.min(count,8);
    atlas.width=cols*cell;atlas.height=Math.ceil(count/cols)*cell;
    const ctx=atlas.getContext('2d');
    const joints=[];
    const axis=new THREE.Vector3(Math.sin(view*Math.PI/4),0,Math.cos(view*Math.PI/4));
    const fit=clip==='gallop'?{gain:1.35,lift:.48,drop:3.0}:{gain:1.05,lift:.20,drop:1.3};
    const travel=pads.map(()=>[]);
    if(clip!=='idle'){
        for(let i=0;i<count;i++){
            pose(clip,i/count);
            pads.forEach((pad,j)=>{
                const p=new THREE.Vector3(...sole(pad));
                travel[j].push({reach:p.dot(axis)*pixelsPerUnit,height:p.y*pixelsPerUnit});
            });
        }
    }
    const centers=travel.map(path=>{
        const values=path.map(p=>p.reach);
        return (Math.min(...values)+Math.max(...values))/2;
    });
    const corrections=clip==='idle'?[]:travel.map((path,j)=>contactCorrection(
        path.map(p=>({...p,reach:p.reach+(p.reach-centers[j])*fit.gain})),
        clip==='gallop'?49.4:21.32));
    let period;
    for(let i=0;i<count;i++) {
        period=pose(clip,i/count);
        if(clip!=='idle'){
            const pelvis=actor.getObjectByName('pelvis');
            const lowered=position(pelvis);
            lowered.y-=fit.drop/pixelsPerUnit;
            pelvis.position.copy(pelvis.parent.worldToLocal(lowered));
            yaw.updateMatrixWorld(true);
            for(const [j,pair] of legPairs.entries()){
                const offset=axis.clone().multiplyScalar(((travel[j][i].reach-centers[j])*fit.gain+corrections[j][i])/pixelsPerUnit);
                const padHeight=sole(pads[j])[1]*pixelsPerUnit+fit.drop;
                offset.y=(fit.drop+Math.max(0,padHeight-.35)*fit.lift)/pixelsPerUnit;
                for(const chain of pair)extendLeg(chain,offset.clone());
            }
        }
        renderer.render(scene,camera);
        ctx.drawImage(renderer.domElement,(i%cols)*cell,Math.floor(i/cols)*cell,cell,cell);
        joints.push(pads.map(sole));
    }
    return {data:atlas.toDataURL('image/png').split(',')[1], period, cell, cols, count, origin, pixelsPerUnit,
            palette, joints, padVertices:pads.map(p=>p.length), restYaw};
};

// Offline full-movement authoring reuses the same source-bound materials,
// weighted pad samples and fixed-length leg solver as the encounter baker.
export {THREE,actor,yaw,scene,camera,renderer,mixer,bind,pose,paws,pads,sole,
    height,pixelsPerUnit,base,restYaw,legPairs,position,rotation,setWorldRotation,
    extendLeg,contactCorrection,cell,origin};
