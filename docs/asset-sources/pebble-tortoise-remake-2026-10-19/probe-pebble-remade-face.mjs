import {writeFile} from 'node:fs/promises';
import * as T from 'three';
import {loadPetDeformationProbe,snapshotPetPose,petClipSampleTimes,preparePetHeadProbe} from '../scripts/lib/pet-deformation-probe.mjs';
const dir='.tmp/pebble-full-remake',model=await loadPetDeformationProbe(dir+'/pebble-remade-private.glb'),mesh=model.meshes[0],restore=snapshotPetPose(model.scene),mixer=new T.AnimationMixer(model.scene);
// Spatial patches selected from the rendered new sculpt, independent of the
// weighting fields. The lower chin is included, not just the eyes and forehead.
const landmarks={crown:[[0,.77,.16],.22],forehead:[[0,.59,.49],.17],leftEye:[[-.30,.42,.57],.16],rightEye:[[.30,.42,.57],.16],muzzle:[[0,.20,.67],.17],leftCheek:[[-.40,.20,.49],.16],rightCheek:[[.40,.20,.49],.16],lowerFace:[[0,.035,.62],.13],chin:[[0,-.065,.45],.115],backSkull:[[0,.48,-.23],.15]};
// The original chin survey sphere also touched the anterior neck and separate
// cloth collar at z=.34. Those are articulated neck/clothing, not the jaw.
// Retain the entire jaw part of that same sphere, including its lowest surface.
const regions=Object.entries(landmarks).map(([name,[center,radius]])=>({name,center,radius,...(name==='chin'?{anatomicalMinZ:.37,excluded:'anterior neck and separate cloth collar, diagnosed vertices 3273 and 26827..26854'}:{}),probe:preparePetHeadProbe(mesh,p=>(name!=='chin'||p.z>=.37)&&new T.Vector3(p.x,p.y,p.z).distanceTo(new T.Vector3(...center))<=radius),maximum:0,pose:null}));
for(const r of regions)if(!r.probe?.measure||r.probe.vertices<20)throw Error('Missing patch '+r.name);
function measure(pose){for(const r of regions){const v=r.probe.measure();if(v.maxDrift>r.maximum){r.maximum=v.maxDrift;r.pose=pose;}}}
let poses=0;for(const clip of model.animations)for(const time of petClipSampleTimes(clip,24)){mixer.stopAllAction();restore();const a=mixer.clipAction(clip).reset().setLoop(T.LoopOnce,1);a.clampWhenFinished=true;a.play();a.time=time;mixer.update(0);model.update();measure({clip:clip.name,time});poses++;}
let blends=0;for(const from of model.animations)for(const to of model.animations)if(from!==to)for(const blend of [.25,.5,.75]){mixer.stopAllAction();restore();for(const[clip,w,p]of[[from,1-blend,.75],[to,blend,.25]]){const a=mixer.clipAction(clip).reset().setLoop(T.LoopOnce,1);a.clampWhenFinished=true;a.setEffectiveWeight(w).play();a.time=clip.duration*p;}mixer.update(0);model.update();measure({from:from.name,to:to.name,blend});blends++;}
const rows=regions.map(({probe,...r})=>({...r,vertices:probe.vertices,edges:probe.edges,failed:r.maximum>.00002}));await writeFile(dir+'/private-face-probe.json',JSON.stringify({sourceSha256:model.sha256,poses,blends,rows,visualApproval:false},null,2));console.log(JSON.stringify(rows,null,2));if(rows.some(r=>r.failed))process.exitCode=1;
