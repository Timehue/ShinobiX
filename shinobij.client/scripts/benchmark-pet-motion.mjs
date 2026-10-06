import * as THREE from 'three';
import { performance } from 'node:perf_hooks';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { advancePetAnimationMixer, preparePetAnimationPhase, transitionPetAnimation } from '../src/lib/pet-animation-lifecycle.ts';

function run(improved) {
    const mixer=new THREE.AnimationMixer(new THREE.Object3D());
    const clips=Array.from({length:13},(_,i)=>new THREE.AnimationClip(`clip-${i}`,1,[new THREE.NumberKeyframeTrack('.position[x]',[0,.5,1],[0,i,0])]));
    let previous=null,maxSettledActions=0,evaluations=0;
    for(let cycle=0;cycle<10;cycle++) for(const clip of clips) {
        const next=mixer.clipAction(clip).reset().play();
        if(improved) transitionPetAnimation(next,previous,.1,false);
        else { next.fadeIn(.1).play(); previous?.fadeOut(.085); }
        if(improved) advancePetAnimationMixer(mixer,.12); else mixer.update(.12);
        maxSettledActions=Math.max(maxSettledActions,mixer.stats.actions.inUse); previous=next;
    }
    const active=mixer.stats.actions.inUse, start=performance.now();
    for(let i=0;i<20000;i++) {
        if(improved) { preparePetAnimationPhase(previous,.34,.74,(i%60)/60); advancePetAnimationMixer(mixer,1/60); evaluations++; }
        else { mixer.update(1/60); previous.time=.34+.4*(i%60)/60; previous.paused=true; mixer.update(0); evaluations+=2; }
    }
    return { maxSettledActions,settledActiveActions:active,sampledFrames:20000,mixerEvaluations:evaluations,elapsedMs:performance.now()-start };
}
// Structural workload measurement; not GPU/FPS certification. Timings are
// Both paths warm up before measurement; counterbalance the measured order.
for(let i=0;i<4;i++) { run(i%2===0); run(i%2!==0); }
const trials=Array.from({length:8},(_,index)=>{
    const order=index%2===0?['before','after']:['after','before'];
    const measured={index,order};
    for(const side of order) measured[side]=run(side==='after');
    return measured;
});
const median=side=>{const values=trials.map(t=>t[side].elapsedMs).sort((a,b)=>a-b);return (values[3]+values[4])/2;};
const result={before:{...trials[7].before,elapsedMs:median('before')},after:{...trials[7].after,elapsedMs:median('after')},trials,method:'13-take mixer lifecycle + 20000 host-sampled frames; four paired warmups then eight order-counterbalanced paired trials; synthetic transform tracks; local Node CPU only'};
await writeFile(resolve(import.meta.dirname,'../../docs/pet-motion-evidence/mixer-comparison.json'),JSON.stringify(result,null,2)); console.log(JSON.stringify(result));
