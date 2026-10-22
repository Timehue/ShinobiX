import {repairAzureRyujinDeathPose} from './lib/pet-azure-death-pose.mjs';
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {loadPetDeformationProbe,loadPetDeformationProbeBytes} from './lib/pet-deformation-probe.mjs';
import {retargetFittedPetPerformances,OMITTED_FITTED_PERFORMANCE_CLIPS} from './lib/pet-retarget-fitted-performances.mjs';
import {freezeVisibleSoleRegions,selectVisibleSoleRegions,measureVisibleLimbPerformances} from './lib/pet-visible-limb-performance.mjs';

// Await both stages inside a suite before child tests and cleanup can run.
// Registering root tests between top-level awaits lets the source-stage tests
// finish and delete the temp directory while battle-stage setup still uses it.
await describe('Azure omitted authored performances', async () => {
const fixture=name=>new URL('./fixtures/'+name,import.meta.url);
const original=await loadPetDeformationProbe(fixture('pet-complete-face-20261015/mythic-6-v1.glb'));
const annotation=JSON.parse(await readFile(fixture('pet-omitted-limb-performances/mythic-6-visible-paws.json')));
const regions=freezeVisibleSoleRegions(original,annotation),temp=await mkdtemp(join(tmpdir(),'azure-omitted-clips-'));
const repairedCases=new Map();
test.after(async()=>{await rm(temp,{recursive:true,force:true,maxRetries:5,retryDelay:100});});

for(const [stage,pin] of [['source','8c2c2bfc468365ec3cac2083756048ee0641393f7de5257514dc501203ce4daa'],['battle','0a2285ed8991899dc6e3654c8d366e70b92b271830cba57471d7730122be51b4']]){
    const path=fixture('pet-omitted-limb-performances/mythic-6-before-'+stage+'.glb');
    const bytes=await readFile(path),candidate=await retargetFittedPetPerformances(bytes,{expectedSha256:pin});
    const out=join(temp,stage+'.glb');await writeFile(out,candidate.bytes);
    const before=await loadPetDeformationProbe(path),after=await loadPetDeformationProbe(out);
    const deliveredBefore=await readFile(fixture(`pet-terminal-action-20261021/mythic-6-${stage}.glb`)),priorDelivered=await loadPetDeformationProbeBytes(deliveredBefore);
    for(const clip of after.animations){const prior=priorDelivered.animations.find(c=>c.name===clip.name);assert.equal(prior.tracks.length,clip.tracks.length);for(const track of clip.tracks){const actual=prior.tracks.find(t=>t.name===track.name);assert.deepEqual(actual.times,track.times);assert.deepEqual(actual.values,track.values);}}
    repairedCases.set(stage,await loadPetDeformationProbeBytes((await repairAzureRyujinDeathPose(deliveredBefore)).bytes));
    const base=stage==='source'?original:await loadPetDeformationProbe(fixture('pet-omitted-limb-performances/mythic-6-original-lod.glb'));
    const selection=selectVisibleSoleRegions(after,regions,{original,stage});
    const baseline=measureVisibleLimbPerformances(base,selectVisibleSoleRegions(base,regions,{original,stage}),{legacy:true});
    const missing=measureVisibleLimbPerformances(before,selection),restored=measureVisibleLimbPerformances(after,selection);
    test(`Azure ${stage}: independent original paw surfaces reproduce lost jump, entrance and victory motion in the old asset`,()=>{
        assert.equal(baseline.length,13);assert.equal(missing.length,13);assert.equal(restored.length,13);
        for(const name of ['gallop_jump','entrance','victory'])for(const paw of Object.keys(regions)){
            const b=baseline.find(c=>c.clip===name).patches[paw].maxLimbContribution;
            assert.ok(b>.005);
            assert.equal(missing.find(c=>c.clip===name).patches[paw].maxLimbContribution,0);
            const value=restored.find(c=>c.clip===name).patches[paw].maxLimbContribution;
            assert.ok(value>b*.2&&value<b*4,`${name}/${paw}: authored performance missing or implausibly amplified`);
        }
    });
    test(`Azure ${stage}: no invented limb tracks in death or fallback idle_2`,()=>{
        for(const name of ['death','idle_2']){
            assert.equal(candidate.report.clips.find(c=>c.name===name).retargetedChannels.length,0);
            for(const paw of Object.keys(regions)){
                assert.equal(baseline.find(c=>c.clip===name).patches[paw].maxLimbContribution,0);
                assert.equal(restored.find(c=>c.clip===name).patches[paw].maxLimbContribution,0);
            }
        }
    });
    test(`Azure ${stage}: exact sculpt, topology, skin streams, original bone frames and bind matrices remain intact`,()=>{
        assert.deepEqual(after.json.nodes,before.json.nodes);
        const a=before.meshes[0],b=after.meshes[0];assert.deepEqual(b.geometry.index.array,a.geometry.index.array);
        for(const name of Object.keys(a.geometry.attributes))assert.deepEqual(b.geometry.attributes[name].array,a.geometry.attributes[name].array);
        a.skeleton.boneInverses.forEach((m,i)=>assert.deepEqual(b.skeleton.boneInverses[i].toArray(),m.toArray()));
        for(const name of ['materials','textures','samplers'])assert.deepEqual(after.json[name],before.json[name]);
        before.json.images.forEach((img,i)=>{const a=before.json.bufferViews[img.bufferView],b=after.json.bufferViews[after.json.images[i].bufferView];assert.deepEqual(before.binary.subarray(a.byteOffset,a.byteOffset+a.byteLength),after.binary.subarray(b.byteOffset,b.byteOffset+b.byteLength));});
    });
    test(`Azure ${stage}: every existing animation curve stays exact across all thirteen clips`,()=>{
        for(const clip of before.animations){const other=after.animations.find(c=>c.name===clip.name);assert.equal(other.duration,clip.duration);
            for(const t of clip.tracks){const q=other.tracks.find(q=>q.name===t.name);assert.ok(q);assert.deepEqual(q.times,t.times);assert.deepEqual(q.values,t.values);assert.equal(q.getInterpolation(),t.getInterpolation());}
            if(!OMITTED_FITTED_PERFORMANCE_CLIPS.includes(clip.name))assert.equal(other.tracks.length,clip.tracks.length);
        }
        if(stage==='source')assert.equal(candidate.report.sha256,'29fe007d1943642b97042072c25a4d7a0fcd5b2be1f28ad0e7dd71971bb17692');
    });
}

for(const stage of ['source','battle'])test(`Azure shipping ${stage}: regenerated asset retains the independent authored paw motion and exact repaired curves`,async()=>{
    const model=await loadPetDeformationProbe(new URL(`../public/pet-models/${stage==='battle'?'warfront-lod/':''}roster/mythic-6.glb`,import.meta.url));
    const base=stage==='source'?original:await loadPetDeformationProbe(fixture('pet-omitted-limb-performances/mythic-6-original-lod.glb'));
    const baseline=measureVisibleLimbPerformances(base,selectVisibleSoleRegions(base,regions,{original,stage}),{legacy:true});
    const measured=measureVisibleLimbPerformances(model,selectVisibleSoleRegions(model,regions,{original,stage}));
    assert.equal(measured.length,13);
    for(const clip of measured)for(const paw of Object.keys(regions)){
        const prior=baseline.find(c=>c.clip===clip.clip).patches[paw].maxLimbContribution,value=clip.patches[paw].maxLimbContribution;
        if(['gallop_jump','entrance','victory'].includes(clip.clip))assert.ok(prior>.005&&value>prior*.2&&value<prior*4,`${clip.clip}/${paw}: final shipping paw motion lost or amplified`);
        if(['death','idle_2'].includes(clip.clip))assert.equal(value,0);
    }
    const repaired=repairedCases.get(stage);
    for(const clip of repaired.animations){const actual=model.animations.find(c=>c.name===clip.name);assert.equal(actual.tracks.length,clip.tracks.length);for(const track of clip.tracks){const t=actual.tracks.find(t=>t.name===track.name);assert.ok(t);assert.deepEqual(t.times,track.times);assert.deepEqual(t.values,track.values);assert.equal(t.getInterpolation(),track.getInterpolation());}}
    assert.equal(model.sha256,repaired.sha256);
});
});
