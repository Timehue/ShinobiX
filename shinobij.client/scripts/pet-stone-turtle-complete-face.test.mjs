import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import * as T from 'three';
import {repairReviewedPetSkull} from './repair-reviewed-pet-skull.mjs';
import {repairStoneTurtleRootClearance} from './repair-stone-turtle-root-clearance.mjs';
import {loadPetDeformationProbe,snapshotPetPose,petClipSampleTimes} from './lib/pet-deformation-probe.mjs';
import {createIndependentFaceProbe} from '../src/pet-independent-face-probe.ts';
const source=new URL('../public/pet-models/roster/standard-5.glb',import.meta.url),dir=new URL('./fixtures/pet-stone-turtle-complete-face/',import.meta.url);
const recipe=JSON.parse(await readFile(new URL('recipe.json',dir))),annotation=JSON.parse(await readFile(new URL('./pet-independent-face-landmarks.json',import.meta.url))).pets['standard-5'];
const rootClips=['attack','cast','idle_hitreact1'];
function sculpt(a,b){assert.deepEqual(a.json.nodes,b.json.nodes);assert.deepEqual(a.meshes[0].geometry.index.array,b.meshes[0].geometry.index.array);for(const name of Object.keys(a.meshes[0].geometry.attributes))assert.deepEqual(a.meshes[0].geometry.attributes[name].array,b.meshes[0].geometry.attributes[name].array);}
function pose(m,mixer,restore,clip,time){mixer.stopAllAction();restore();const a=mixer.clipAction(clip).reset().setLoop(T.LoopOnce,1);a.clampWhenFinished=true;a.play();a.time=time;mixer.update(0);m.update();}
function floorSweep(m){const mesh=m.meshes[0],p=new T.Vector3(),minimum=()=>{let y=Infinity;for(let v=0;v<mesh.geometry.attributes.position.count;v++)y=Math.min(y,mesh.getVertexPosition(v,p).applyMatrix4(mesh.matrixWorld).y);return y;},ground=minimum(),restore=snapshotPetPose(m.scene),mixer=new T.AnimationMixer(m.scene),result=[];for(const name of rootClips){const clip=m.animations.find(c=>c.name===name),steps=Math.ceil(clip.duration*480);let min=Infinity;for(let i=0;i<=steps;i++){pose(m,mixer,restore,clip,Math.min(clip.duration,(i+.37)*clip.duration/steps));min=Math.min(min,minimum());}result.push({name,clearance:min-ground});}return result;}
function faceSweep(m,blends=true){const probe=createIndependentFaceProbe(m.meshes,annotation),mixer=new T.AnimationMixer(m.scene),restore=snapshotPetPose(m.scene);let samples=0;for(const clip of m.animations)for(const time of petClipSampleTimes(clip,24)){pose(m,mixer,restore,clip,time);probe.measure(time);samples++;}let blendPoses=0;if(blends)for(const from of m.animations)for(const to of m.animations)if(from!==to)for(const blend of[.25,.5,.75]){mixer.stopAllAction();restore();for(const[clip,w,p]of[[from,1-blend,.75],[to,blend,.25]]){const a=mixer.clipAction(clip).reset().setLoop(T.LoopOnce,1);a.clampWhenFinished=true;a.setEffectiveWeight(w).play();a.time=clip.duration*p;}mixer.update(0);m.update();probe.measure(blend);blendPoses++;}return{...probe.report(),samples,blendPoses};}

test('Stone Turtle jaw repair replays exactly while retaining sculpt, rig and every original curve',async()=>{
    const temp=await mkdtemp(join(tmpdir(),'stone-jaw-'));try{const path=join(temp,'jaw.glb');await repairReviewedPetSkull('standard-5',fileURLToPath(new URL('standard-5-before.glb',dir)),path,recipe.config);const before=await loadPetDeformationProbe(new URL('standard-5-before.glb',dir)),after=await loadPetDeformationProbe(path);assert.equal(after.sha256,recipe.jawOnlySha256);assert.deepEqual(after.json.nodes,before.json.nodes);assert.deepEqual(after.meshes[0].geometry.index.array,before.meshes[0].geometry.index.array);for(const name of Object.keys(before.meshes[0].geometry.attributes))if(!['skinIndex','skinWeight'].includes(name))assert.deepEqual(after.meshes[0].geometry.attributes[name].array,before.meshes[0].geometry.attributes[name].array);for(const clip of before.animations){const next=after.animations.find(c=>c.name===clip.name);assert.equal(next.duration,clip.duration);for(const track of clip.tracks){const n=next.tracks.find(t=>t.name===track.name);assert.deepEqual(n.times,track.times);assert.deepEqual(n.values,track.values);}}}finally{await rm(temp,{recursive:true,force:true});}
});
test('Stone Turtle root correction replays exactly, retaining skin, bind and all articulation',async()=>{
    const temp=await mkdtemp(join(tmpdir(),'stone-ground-'));try{const path=join(temp,'ground.glb'),r=await repairStoneTurtleRootClearance(fileURLToPath(new URL('jaw-only-before.glb',dir)),path);assert.equal(r.sha256,recipe.expectedSha256);const before=await loadPetDeformationProbe(new URL('jaw-only-before.glb',dir)),after=await loadPetDeformationProbe(path);sculpt(before,after);for(const clip of before.animations)for(const track of clip.tracks){const n=after.animations.find(c=>c.name===clip.name).tracks.find(t=>t.name===track.name);if(rootClips.includes(clip.name)&&track.name==='root.position'){const a=track.createInterpolant(),b=n.createInterpolant();for(let i=0;i<=137;i++){const t=clip.duration*i/137,x=a.evaluate(t),y=b.evaluate(t);for(const axis of[0,2])assert.ok(Math.abs(x[axis]-y[axis])<2e-6,`${clip.name}: horizontal root changed`);}continue;}assert.deepEqual(n.times,track.times);assert.deepEqual(n.values,track.values);}}finally{await rm(temp,{recursive:true,force:true});}
});
test('frozen complete-face regions detect the original lower-jaw distortion',async()=>{
    const result=faceSweep(await loadPetDeformationProbe(new URL('standard-5-before.glb',dir)),false);assert.equal(result.failed,true);assert.equal(result.regions.length,8);
});
test('independent offset surface sweep detects original foot penetration in all three supported actions',async()=>{
    const rows=floorSweep(await loadPetDeformationProbe(new URL('jaw-only-before.glb',dir)));for(const row of rows)assert.ok(row.clearance<-.003,JSON.stringify(row));
});
for(const stage of['source','battle']){
    const path=stage==='source'?source:new URL('../public/pet-models/warfront-lod/roster/standard-5.glb',import.meta.url);
    test(`Stone Turtle ${stage} keeps its feet above the bind floor at independent 480 Hz offsets`,async()=>{const m=await loadPetDeformationProbe(path);assert.equal(m.json.extras.characterMotion.plantedAttack,true);assert.equal(m.json.extras.characterMotion.plantedRecoil,true);for(const row of floorSweep(m))assert.ok(row.clearance>=-.0005,JSON.stringify(row));});
    test(`Stone Turtle ${stage} preserves eight frozen facial regions through all clips and 468 blends`,async()=>{const result=faceSweep(await loadPetDeformationProbe(path));assert.equal(result.failed,false,JSON.stringify(result));assert.equal(result.regions.length,8);assert.equal(result.blendPoses,468);assert.ok(result.samples>170);for(const region of result.regions)assert.ok(region.vertices>=20,region.name);});
}
