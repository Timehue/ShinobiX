import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import * as THREE from 'three';
import {repairDuneViperLegRig} from './lib/pet-dune-viper-four-leg-rig.mjs';
import {calibratePetVisibleGround} from './lib/pet-visible-ground-calibration.mjs';
import {loadPetDeformationProbe,snapshotPetPose} from './lib/pet-deformation-probe.mjs';
import {createCachedPetVertexReader} from './lib/pet-cached-skin-reader.mjs';

test('the fitted four-legged Viper retains its performances while clearing the floor between authoring samples',async()=>{
    const temporaryRoot=resolve(tmpdir()),directory=await mkdtemp(join(temporaryRoot,'pet-viper-four-leg-floor-'));
    const models=[];
    try{
        const sourcePath=join(directory,'input-source.glb'),battlePath=fileURLToPath(new URL('./fixtures/pet-dune-viper-four-legs-20261021/battle-before-floor.glb',import.meta.url));
        const original=await readFile(new URL('./fixtures/pet-dune-viper-four-legs-20261021/original.glb',import.meta.url));
        await writeFile(sourcePath,(await repairDuneViperLegRig(original)).bytes);
        const result=await calibratePetVisibleGround({id:'rare-6',sourcePath,battlePath,sourceOutput:join(directory,'source.glb'),battleOutput:join(directory,'battle.glb'),sampleHz:480,keySubdivisions:4,padding:.0021,inputPins:{source:'08f51ca825d1ce6fb9b7dd92ba0a91f8cf2b7115b7e71622d3914fd73aede6d8',battle:'8fcdaefb5fb37d7d93f8deaa4665492091a6a57bb050b9ad2a9c33cfd12222a5'}});
        assert.deepEqual(result.outputs.map(row=>row.sha256),['4d3136a78c73e66269ada4b2f02bcade5b279aa6dd7ea03a56d5c712e9ec398c','8a713fca3ad3b93464e9885fdfb4316931bdd8900df4b1f2bf4dd60d8af5ceab']);
        for(const output of result.outputs){
            const before=await loadPetDeformationProbe(output.stage==='source'?sourcePath:battlePath),after=await loadPetDeformationProbe(output.path);models.push(before,after);
            const mixer=new THREE.AnimationMixer(after.scene),restore=snapshotPetPose(after.scene),reader=createCachedPetVertexReader(after.meshes),point=new THREE.Vector3();let clearance=Infinity;
            for(const clip of after.animations){
                const prior=before.animations.find(take=>take.name===clip.name);assert.equal(clip.duration,prior.duration);
                const root=clip.tracks.find(t=>t.name==='root.position'),oldRoot=prior.tracks.find(t=>t.name==='root.position');
                for(const track of clip.tracks)if(track!==root){const old=prior.tracks.find(t=>t.name===track.name);assert.deepEqual(track.times,old.times);assert.deepEqual(track.values,old.values);assert.equal(track.getInterpolation(),old.getInterpolation());}
                const a=root.createInterpolant(new Float32Array(3)),b=oldRoot.createInterpolant(new Float32Array(3)),count=Math.ceil(clip.duration*120);
                for(const time of [0,...Array.from({length:count},(_,i)=>(i+.37)*clip.duration/count),clip.duration]){
                    const p=a.evaluate(time),q=b.evaluate(time);assert.ok(Math.abs(p[0]-q[0])<.000002&&Math.abs(p[2]-q[2])<.000002);assert.ok(p[1]>=q[1]-.000002);
                    mixer.stopAllAction();restore();const action=mixer.clipAction(clip).reset().setLoop(THREE.LoopOnce,1);action.clampWhenFinished=true;action.play();action.time=time;mixer.update(0);after.update();reader.sync();
                    for(const mesh of after.meshes)for(let v=0;v<mesh.geometry.attributes.position.count;v++)clearance=Math.min(clearance,reader.getVertexPosition(mesh,v,point).applyMatrix4(mesh.matrixWorld).y-result.ground);
                }
            }
            mixer.stopAllAction();assert.ok(clearance>=.0018,`${output.stage}: floor clearance ${clearance}`);
        }
    }finally{
        for(const model of models)for(const mesh of model.meshes)mesh.geometry.dispose();
        assert.equal(dirname(resolve(directory)),temporaryRoot);assert.ok(resolve(directory).startsWith(join(temporaryRoot,'pet-viper-four-leg-floor-')));await rm(directory,{recursive:true,force:true});
    }
});
