import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import * as THREE from 'three';
import {repairLoamMarmotDuplicateTail} from './lib/pet-loam-marmot-sculpt.mjs';
import {loadPetDeformationProbeBytes,snapshotPetPose} from './lib/pet-deformation-probe.mjs';
import {calibratePetVisibleGround} from './lib/pet-visible-ground-calibration.mjs';
import {createIndependentFaceProbe} from '../src/pet-independent-face-probe.ts';
const original=await readFile(new URL('./fixtures/pet-marmot-single-tail-20261021/original.glb',import.meta.url));
const result=await repairLoamMarmotDuplicateTail(original);
test('Marmot sculpt repair reproduces its reviewed closed-tail surface and preserves the complete upper body',async()=>{
 assert.equal(result.report.candidateSha256,'be1969da3d88cf8482f5bc11fab55bc601598a4f7dc57c5c0c6c042b2d74fcfc');
 assert.equal(result.report.removedTriangles,2070);assert.equal(result.report.capTriangles,96);assert.equal(result.report.newCutEdgesClosed,true);
 const a=await loadPetDeformationProbeBytes(original),b=await loadPetDeformationProbeBytes(result.bytes);
 // Reindexing is intentional. Compare actual spatially identified upper-body
 // surface data, without substituting a new facial annotation for the repair.
 const upper=model=>{const attrs=model.meshes[0].geometry.attributes,p=attrs.position,rows=[];for(let i=0;i<p.count;i++)if(p.getY(i)>.1)rows.push(['position','normal','uv','skinIndex','skinWeight'].flatMap(name=>Array.from({length:attrs[name].itemSize},(_,k)=>attrs[name].getComponent(i,k))).join(','));return rows.sort();};
 assert.deepEqual(upper(b),upper(a));
 const motion=clips=>clips.map(c=>{const {uuid,...data}=c.toJSON();return data;});assert.deepEqual(motion(b.animations),motion(a.animations));
 const annotation=JSON.parse(await readFile(new URL('./pet-independent-face-landmarks.json',import.meta.url))).pets['standard-49'];
 const mixer=new THREE.AnimationMixer(b.scene),restore=snapshotPetPose(b.scene),probe=createIndependentFaceProbe(b.meshes,annotation);
 const action=(clip,phase,weight=1)=>{const take=mixer.clipAction(clip).reset().setLoop(THREE.LoopOnce,1);take.clampWhenFinished=true;take.setEffectiveWeight(weight).play();take.time=clip.duration*phase;};
 for(const clip of b.animations)for(let i=0;i<=24;i++){mixer.stopAllAction();restore();action(clip,i/24);mixer.update(0);b.update();probe.measure(i/24);}
 for(const from of b.animations)for(const to of b.animations)if(from!==to)for(const w of [.25,.5,.75]){mixer.stopAllAction();restore();action(from,.75,1-w);action(to,.25,w);mixer.update(0);b.update();probe.measure(w);}
 assert.equal(probe.report().failed,false);
 await assert.rejects(repairLoamMarmotDuplicateTail(Buffer.from('wrong source')),/AssertionError/);
});
test('Marmot revised sculpt keeps exact input pinning and replays the reviewed floor calibration',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'marmot-sculpt-'));
 try{
  const sourcePath=join(dir,'sculpt.glb');await writeFile(sourcePath,result.bytes);
  const options={id:'standard-49',sourcePath,battlePath:fileURLToPath(new URL('./fixtures/pet-marmot-single-tail-20261021/reviewed-battle.glb',import.meta.url)),sourceOutput:join(dir,'source.glb'),battleOutput:join(dir,'battle.glb')};
  await assert.rejects(calibratePetVisibleGround(options),/unexpected input/);
  await assert.rejects(calibratePetVisibleGround({...options,inputPins:{source:'0'.repeat(64),battle:'0'.repeat(64)}}),/unexpected input/);
  const actual=await calibratePetVisibleGround({...options,inputPins:{source:result.report.candidateSha256,battle:'ed131bfacd0becfdc25cc92d836cde078c05ec9d94104e944cdf97c3cb91dc5b'}});
  const hash=async path=>(await import('node:crypto')).createHash('sha256').update(await readFile(path)).digest('hex');
  assert.equal(await hash(options.sourceOutput),'b0460aea919abb8bf18c368a57685c5ba599ddaf942d753a4effb2650eb496e7');
  assert.equal(await hash(options.battleOutput),'1f5117dff1ff08fe4bc8814563a6c87867a923bee81a88bbfec574f72c8dad77');
  assert.equal(actual.corrections.length,13);
 }finally{await rm(dir,{recursive:true,force:true});}
});
