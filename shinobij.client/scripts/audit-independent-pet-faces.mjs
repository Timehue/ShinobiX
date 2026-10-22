// Anatomical samples come from separately inspected rendered landmarks.
// This tool never imports a repair mask or treats a numeric pass as art approval.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import * as THREE from 'three';
import { runtimePetModels } from './lib/pet-runtime-audit.mjs';
import { loadPetDeformationProbe, preparePetHeadProbe, snapshotPetPose, petClipSampleTimes } from './lib/pet-deformation-probe.mjs';
import { petFaceGeometryFingerprint } from './lib/pet-face-geometry-fingerprint.mjs';

const arg=(key,fallback)=>process.argv.find(v=>v.startsWith(`--${key}=`))?.slice(key.length+3)??fallback;
const config=JSON.parse(await readFile(resolve(import.meta.dirname,'pet-independent-face-landmarks.json')));
const client=resolve(import.meta.dirname,'..'),ids=arg('model')?.split(','),stages=arg('stage','source,battle').split(',');
if(stages.some(stage=>!['source','battle'].includes(stage)))throw Error('Unknown asset stage');
const results=[];
const selected=runtimePetModels.filter(r=>!ids||ids.includes(r.pet.id));
if(!selected.length||ids?.some(id=>!selected.some(row=>row.pet.id===id)))throw Error('Empty or incomplete pet selection');
for(const row of selected)for(const stage of stages){
    const annotation=config.pets[row.pet.id],root=arg(`${stage}-root`);
    if(!annotation?.landmarks||!annotation.heads?.length||annotation.heads.length!==annotation.headCountVisuallyVerified)throw Error(`${row.pet.id}: independently inspected complete-face coverage missing`);
    for(const head of annotation.heads)if(head.landmarks.length<3||head.landmarks.some(name=>!annotation.landmarks[name]))throw Error(`${row.pet.id}/${head.id}: upper, muzzle/beak and lower-face landmarks missing`);
    const path=root?resolve(root,relative(resolve(client,'public/pet-models'),row.path))
        :stage==='source'?row.path:resolve(client,'public/pet-models/warfront-lod',relative(resolve(client,'public/pet-models'),row.path));
    const model=await loadPetDeformationProbe(path);
    if(model.meshes.length!==1)throw Error(`${row.pet.id}: annotate each surface before measuring a multi-surface model`);
    if(stage==='source'&&petFaceGeometryFingerprint(model)!==annotation.geometrySha256)throw Error(`${row.pet.id}: sculpt, topology, texture or rig changed after anatomical annotation`);
    if(annotation.geometryToVisibleBind?.length!==16)throw Error(`${row.pet.id}: frozen anatomical coordinate frame missing`);
    const mesh=model.meshes[0],envelope=new THREE.Matrix4().fromArray(annotation.geometryToVisibleBind),point=new THREE.Vector3();
    const regions=Object.entries(annotation.landmarks).map(([name,landmark])=>{
        const center=new THREE.Vector3().fromArray(landmark.center);
        if(landmark.center.length!==3||!landmark.center.every(Number.isFinite)||!(landmark.radius>0))throw Error('Invalid anatomical landmark');
        const probe=preparePetHeadProbe(mesh,p=>point.set(p.x,p.y,p.z).applyMatrix4(envelope).distanceTo(center)<=landmark.radius,landmark.anchorBone??'head');
        if(!probe?.measure||probe.edges<3)throw Error(`${row.pet.id}/${stage}/${name}: incomplete anatomical coverage (${probe?.vertices??0} vertices)`);
        return {name,landmark,probe};
    });
    const restore=snapshotPetPose(model.scene),mixer=new THREE.AnimationMixer(model.scene);
    const summary=()=>regions.map(r=>({name:r.name,vertices:r.probe.vertices,edges:r.probe.edges,maxDrift:0,worldMinRatio:1,worldMaxRatio:1}));
    const measure=(values,pose)=>regions.forEach((region,i)=>{
        const v=region.probe.measure(),value=values[i];
        if(v.maxDrift>value.maxDrift){value.maxDrift=v.maxDrift;value.maximumPose=pose;}
        value.worldMinRatio=Math.min(value.worldMinRatio,v.worldMinRatio);value.worldMaxRatio=Math.max(value.worldMaxRatio,v.worldMaxRatio);
    });
    const clips=[];
    for(const clip of model.animations){
        const regions=summary(),times=petClipSampleTimes(clip,24);
        for(const time of times){
            mixer.stopAllAction();restore();const action=mixer.clipAction(clip).reset().setLoop(THREE.LoopOnce,1);
            action.clampWhenFinished=true;action.play();action.time=time;mixer.update(0);model.update();measure(regions,time);
        }
        clips.push({clip:clip.name,poses:times.length,regions});
    }
    const blends=summary();let blendPoses=0;
    if(process.argv.includes('--blends'))for(const from of model.animations)for(const to of model.animations)if(from!==to)for(const blend of [.25,.5,.75]){
        mixer.stopAllAction();restore();
        for(const[clip,weight,progress]of[[from,1-blend,.75],[to,blend,.25]]){const action=mixer.clipAction(clip).reset().setLoop(THREE.LoopOnce,1);action.clampWhenFinished=true;action.setEffectiveWeight(weight).play();action.time=clip.duration*progress;}
        mixer.update(0);model.update();measure(blends,{from:from.name,to:to.name,blend});blendPoses++;
    }
    const failed=[...clips.flatMap(c=>c.regions),...blends].some(v=>![v.maxDrift,v.worldMinRatio,v.worldMaxRatio].every(Number.isFinite)||v.maxDrift>.00002||v.worldMinRatio<.985||v.worldMaxRatio>1.015);
    results.push({id:row.pet.id,name:row.pet.name,stage,sha256:model.sha256,annotationSourceSha256:annotation.sourceSha256,landmarks:annotation.landmarks,clips,blends,blendPoses,failed});
    console.log(JSON.stringify({id:row.pet.id,stage,failed,peakDrift:Math.max(...clips.flatMap(c=>c.regions.map(r=>r.maxDrift))),blendPoses}));
    mixer.stopAllAction();model.meshes.forEach(m=>m.geometry.dispose());
}
if(!results.length)throw Error('No independently annotated pets selected');
const out=resolve(client,'.tmp/pet-independent-face-recheck/probes');await mkdir(out,{recursive:true});
const report={summary:{assets:results.length,failures:results.filter(r=>r.failed).length},artisticCertification:false,results};
await writeFile(resolve(out,`${arg('label','independent')}.json`),JSON.stringify(report,null,2)+'\n');
if(report.summary.failures)process.exitCode=1;
