import assert from 'node:assert/strict';
import * as T from 'three';
import {snapshotPetPose} from './pet-deformation-probe.mjs';

const point=(mesh,index)=>mesh.getVertexPosition(index,new T.Vector3()).applyMatrix4(mesh.matrixWorld);
export function freezeVisibleSoleRegions(original,annotation) {
    assert.equal(original.sha256,annotation.sourceSha256,'Independent anatomical original changed');
    assert.equal(annotation.coverageActuallyInspected,true,'Original anatomical coverage must be inspected');
    const mesh=original.meshes[0],regions={};
    for(const[name,patch]of Object.entries(annotation.patches)){
        assert.ok(patch.indices.length>=8,`${name}: too few original surface points`);
        const box=new T.Box3().setFromPoints(patch.indices.map(i=>point(mesh,i)));
        // Large sculpted feet need an explicit limit frozen with the original
        // anatomical annotation. Never infer this allowance from fitted weights.
        const spanLimit=patch.maxOriginalSpan??.25;
        assert.ok(Number.isFinite(spanLimit)&&spanLimit>0&&spanLimit<=.8,`${name}: invalid original sole span limit`);
        assert.ok(box.getSize(new T.Vector3()).length()<spanLimit,`${name}: contaminated sole region`);
        assert.ok(box.max.y-box.min.y<.04,`${name}: non-sole geometry in patch`);
        regions[name]={indices:patch.indices.slice(),min:box.min.toArray(),max:box.max.toArray(),center:box.getCenter(new T.Vector3()).toArray(),parent:name.startsWith('front')?'chest':'pelvis'};
    }
    const list=Object.values(regions);
    for(let i=0;i<list.length;i++)for(let j=0;j<i;j++)assert.ok(new T.Vector3().fromArray(list[i].center).distanceTo(new T.Vector3().fromArray(list[j].center))>.08,'Independent sole patches overlap');
    return regions;
}

// Source vertex IDs are frozen before any repair. LOD membership uses only
// those original bound-rest boxes; fitted weights never choose test vertices.
export function selectVisibleSoleRegions(model,regions,{original,stage='source',padding=.002}={}){
    const mesh=model.meshes[0],selected={};
    if(stage==='source')assert.deepEqual(mesh.geometry.attributes.position.array,original.meshes[0].geometry.attributes.position.array,'Source sculpt changed');
    const all=stage==='battle'?Array.from({length:mesh.geometry.attributes.position.count},(_,i)=>point(mesh,i)):null;
    for(const[name,r]of Object.entries(regions)){
        const box=new T.Box3(new T.Vector3().fromArray(r.min),new T.Vector3().fromArray(r.max)).expandByScalar(padding);
        const indices=stage==='source'?r.indices.slice():all.flatMap((p,i)=>box.containsPoint(p)?[i]:[]);
        assert.ok(indices.length>=8,`${stage}/${name}: insufficient independently selected sole vertices`);
        for(const i of indices)assert.ok(box.containsPoint(point(mesh,i)),`${stage}/${name}: tail, face or other non-sole vertex contaminates frozen box`);
        selected[name]={...r,indices};
    }
    const seen=new Set();for(const r of Object.values(selected))for(const i of r.indices){assert.ok(!seen.has(i),'Sole membership overlap');seen.add(i);}
    return selected;
}

export function measureVisibleLimbPerformances(model,regions,{legacy=false,samples=33,limbNames}={}){
    const mesh=model.meshes[0],restore=snapshotPetPose(model.scene),mixer=new T.AnimationMixer(model.scene);
    const limb=/^(?:(?:front|hind)_(?:upper|lower|paw)|upper_arm|forearm|hand|thigh|shin|foot)[LR]\./;
    const fitted=/^(?:front|hind)_(?:upper|lower|paw)[LR]\./;
    const scope=limbNames?new Set(limbNames):null;
    if(scope)for(const name of scope)assert.ok(mesh.skeleton.bones.some(b=>b.name===name),`Unknown counterfactual limb: ${name}`);
    const isLimbTrack=track=>(legacy?limb.test(track.name.replace(/^legacy_/,'')):fitted.test(track.name))
        &&(!scope||scope.has(track.name.slice(0,track.name.lastIndexOf('.'))));
    const results=[];
    function pose(clip,time){mixer.stopAllAction();restore();const a=mixer.clipAction(clip).reset().setLoop(T.LoopOnce,1);a.clampWhenFinished=true;a.play();a.time=time;mixer.update(0);model.update();}
    for(const clip of model.animations){
        const frozen=clip.clone();frozen.tracks=frozen.tracks.filter(t=>!isLimbTrack(t));
        const patches=Object.fromEntries(Object.entries(regions).map(([name,r])=>[name,{points:r.indices.length,maxLimbContribution:0,maxParentRelativeFlex:0}]));
        const initial={};
        for(let i=0;i<samples;i++){
            const time=clip.duration*i/(samples-1);pose(clip,time);const normal={};
            for(const[name,r]of Object.entries(regions)){
                const parent=mesh.skeleton.bones.find(b=>b.name===r.parent);assert.ok(parent);const inverse=parent.matrixWorld.clone().invert();
                normal[name]=r.indices.map(index=>point(mesh,index));const relative=normal[name].map(p=>p.clone().applyMatrix4(inverse));
                if(i===0)initial[name]=relative;
                for(let j=0;j<relative.length;j++)patches[name].maxParentRelativeFlex=Math.max(patches[name].maxParentRelativeFlex,relative[j].distanceTo(initial[name][j]));
            }
            pose(frozen,time);
            for(const[name,r]of Object.entries(regions))for(const[j,index]of r.indices.entries())patches[name].maxLimbContribution=Math.max(patches[name].maxLimbContribution,point(mesh,index).distanceTo(normal[name][j]));
        }
        results.push({clip:clip.name,samples,frozenLimbChannels:clip.tracks.filter(isLimbTrack).length,
            ...(scope?{frozenLimbTrackNames:clip.tracks.filter(isLimbTrack).map(t=>t.name)}:{}),patches});
        mixer.uncacheClip(frozen);mixer.uncacheClip(clip);
    }
    mixer.stopAllAction();restore();model.update();return results;
}
