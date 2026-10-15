import { readFile,writeFile,mkdir } from 'node:fs/promises';
import { resolve,relative } from 'node:path';
import * as THREE from 'three';
import { runtimePetModels } from './lib/pet-runtime-audit.mjs';
import { loadPetDeformationProbe,preparePetHeadProbe,snapshotPetPose,petClipSampleTimes } from './lib/pet-deformation-probe.mjs';
import { petSkullEnvelopeMatrix,petSkullRegionShare } from './lib/pet-skull-region.mjs';

const root=resolve(import.meta.dirname,'..'),regions=JSON.parse(await readFile(resolve(import.meta.dirname,'pet-skull-regions.json'))).pets;
const argument=key=>process.argv.find(a=>a.startsWith(`--${key}=`))?.slice(key.length+3);
const filter=argument('model')?.split(','),assetRoot=argument('asset-root'),label=argument('label')??'reviewed';
const blendCheck=process.argv.includes('--blends'),rows=runtimePetModels.filter(r=>regions[r.pet.id]&&(!filter||filter.includes(r.pet.id)));
if(!rows.length)throw Error('No reviewed skulls selected');
const report=[];
for(const row of rows) {
    const source=assetRoot?resolve(assetRoot,relative(resolve(root,'public/pet-models'),row.path)):row.path;
    const model=await loadPetDeformationProbe(source),mesh=model.meshes[0],config=regions[row.pet.id];
    const recorded=model.json.extras?.reviewedSkullRepair?.envelopeMatrix;
    const envelope=recorded?new THREE.Matrix4().fromArray(recorded):petSkullEnvelopeMatrix(model,row.model.yawOffset);
    const probe=preparePetHeadProbe(mesh,p=>petSkullRegionShare(new THREE.Vector3(p.x,p.y,p.z).applyMatrix4(envelope),config)===1,config.anchorBone??'head');
    if(!probe?.measure)throw Error(`${row.pet.id}: incomplete anatomical coverage`);
    const restore=snapshotPetPose(model.scene),mixer=new THREE.AnimationMixer(model.scene),clips=[];
    for(const clip of model.animations) {
        let maxDrift=0,minRatio=1,maxRatio=1,maximumVertex=-1,maximumTime=0,worldMinRatio=1,worldMaxRatio=1;
        const times=petClipSampleTimes(clip,24);
        for(const time of times) {
            mixer.stopAllAction();restore();const action=mixer.clipAction(clip).reset().setLoop(THREE.LoopOnce,1);action.clampWhenFinished=true;action.play();action.time=time;mixer.update(0);model.update();
            const value=probe.measure();if(value.maxDrift>maxDrift){maxDrift=value.maxDrift;maximumVertex=value.maximumVertex;maximumTime=time;}minRatio=Math.min(minRatio,value.minRatio);maxRatio=Math.max(maxRatio,value.maxRatio);worldMinRatio=Math.min(worldMinRatio,value.worldMinRatio);worldMaxRatio=Math.max(worldMaxRatio,value.worldMaxRatio);
        }
        const p=mesh.geometry.attributes.position,vertex=maximumVertex<0?null:new THREE.Vector3(p.getX(maximumVertex),p.getY(maximumVertex),p.getZ(maximumVertex)).applyMatrix4(envelope).toArray();
        clips.push({clip:clip.name,poses:times.length,maxDrift,minRatio,maxRatio,worldMinRatio,worldMaxRatio,maximumVertex,maximumTime,maximumBindPoint:vertex});
    }
    let blendDrift=0,blendPoses=0,blendWorldMinRatio=1,blendWorldMaxRatio=1;
    if(blendCheck)for(const from of model.animations)for(const to of model.animations)if(from!==to)for(const blend of [.25,.5,.75]) {
        mixer.stopAllAction();restore();
        for(const [clip,weight,progress] of [[from,1-blend,.75],[to,blend,.25]]){const action=mixer.clipAction(clip).reset().setLoop(THREE.LoopOnce,1);action.clampWhenFinished=true;action.setEffectiveWeight(weight).play();action.time=clip.duration*progress;}
        mixer.update(0);model.update();const value=probe.measure();blendDrift=Math.max(blendDrift,value.maxDrift);blendWorldMinRatio=Math.min(blendWorldMinRatio,value.worldMinRatio);blendWorldMaxRatio=Math.max(blendWorldMaxRatio,value.worldMaxRatio);blendPoses++;
    }
    report.push({id:row.pet.id,name:row.pet.name,sha256:model.sha256,region:config,vertices:probe.vertices,edges:probe.edges,clips,blendDrift,blendPoses,blendWorldMinRatio,blendWorldMaxRatio,
        failed:clips.some(c=>['maxDrift','minRatio','maxRatio','worldMinRatio','worldMaxRatio'].some(k=>!Number.isFinite(c[k]))||c.maxDrift>.00002||c.minRatio<.999||c.maxRatio>1.001||c.worldMinRatio<.985||c.worldMaxRatio>1.015)||![blendDrift,blendWorldMinRatio,blendWorldMaxRatio].every(Number.isFinite)||blendDrift>.00002||blendWorldMinRatio<.985||blendWorldMaxRatio>1.015});
    console.log(`${row.pet.id}: ${report.at(-1).failed?'distortion':'coherent'}; ${probe.vertices} skull vertices`);
    mixer.stopAllAction();model.meshes.forEach(m=>m.geometry.dispose());
}
const output=resolve(root,'.tmp/pet-reviewed-skulls');await mkdir(output,{recursive:true});
await writeFile(resolve(output,`${label}.json`),JSON.stringify({summary:{pets:report.length,failures:report.filter(r=>r.failed).length,poses:report.reduce((n,r)=>n+r.clips.reduce((n,c)=>n+c.poses,0)+r.blendPoses,0)},pets:report},null,2)+'\n');
if(report.some(r=>r.failed))process.exitCode=1;
