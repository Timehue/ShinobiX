import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import * as T from 'three';
import {repairOniAnatomicalLimbs} from './lib/pet-oni-anatomical-limbs.mjs';
import {repairOniCoordinatedActions} from './lib/pet-oni-anatomical-actions.mjs';
import {retargetFittedPetPerformances,OMITTED_FITTED_PERFORMANCE_CLIPS} from './lib/pet-retarget-fitted-performances.mjs';
import {loadPetDeformationProbe} from './lib/pet-deformation-probe.mjs';
import {freezeVisibleSoleRegions,selectVisibleSoleRegions,measureVisibleLimbPerformances} from './lib/pet-visible-limb-performance.mjs';

const originalPath=new URL('./fixtures/pet-oni-anatomical-limbs/mythic-4.glb',import.meta.url);
const original=await loadPetDeformationProbe(originalPath),annotation=JSON.parse(await readFile(new URL('./fixtures/pet-oni-anatomical-limbs/visible-paw-landmarks.json',import.meta.url)));
const regions=freezeVisibleSoleRegions(original,annotation),temp=await mkdtemp(join(tmpdir(),'oni-omitted-performance-'));
test.after(async()=>{await rm(temp,{recursive:true,force:true});});
const sourceBefore=(await repairOniCoordinatedActions((await repairOniAnatomicalLimbs(await readFile(originalPath))).bytes)).bytes;
const cases=[];
for(const stage of ['source','battle']){
    const beforeBytes=stage==='source'?sourceBefore:await readFile(new URL('./fixtures/pet-omitted-limb-performances/mythic-4-before-lod.glb',import.meta.url));
    const pin=stage==='source'?'d6f30574c4e1f0d0b6f004fc08f38db254bc40cb3fe6f775593d97472aa6804c':'9c56d19d9f817caf977b67043acd632682aeccd84ea17d1cd1175bfff8cbf757';
    const candidate=await retargetFittedPetPerformances(beforeBytes,{expectedSha256:pin});
    const beforePath=join(temp,stage+'-before.glb'),candidatePath=join(temp,stage+'-candidate.glb');
    await writeFile(beforePath,beforeBytes);await writeFile(candidatePath,candidate.bytes);
    const before=await loadPetDeformationProbe(beforePath),after=await loadPetDeformationProbe(candidatePath);
    const base=stage==='source'?original:await loadPetDeformationProbe(new URL('./fixtures/pet-omitted-limb-performances/mythic-4-original-lod.glb',import.meta.url));
    const baseSelection=selectVisibleSoleRegions(base,regions,{original,stage});
    const selection=selectVisibleSoleRegions(after,regions,{original,stage});
    cases.push({stage,pin,beforeBytes,candidate,before,after,baseSelection,selection,
        originalMotion:measureVisibleLimbPerformances(base,baseSelection,{legacy:true}),
        beforeMotion:measureVisibleLimbPerformances(before,selection),
        afterMotion:measureVisibleLimbPerformances(after,selection)});
}

function requireRetainedAuthoredPawMotion(current,base){
    for(const clip of base.filter(c=>OMITTED_FITTED_PERFORMANCE_CLIPS.includes(c.clip))){
        const measured=current.find(c=>c.clip===clip.clip);assert.ok(measured);
        for(const[name,r]of Object.entries(clip.patches))if(r.maxLimbContribution>.005){
            assert.ok(measured.patches[name].maxLimbContribution>r.maxLimbContribution*.2,`${clip.clip}/${name}: authored paw movement lost`);
            assert.ok(measured.patches[name].maxLimbContribution<r.maxLimbContribution*4,`${clip.clip}/${name}: implausibly magnified paw movement`);
        }
    }
}
for(const r of cases){
    test(`Oni ${r.stage}: all thirteen clips sampled on independent paw surfaces; current omitted performances fail and retargeted performances pass`,()=>{
        assert.equal(r.originalMotion.length,13);assert.equal(r.afterMotion.length,13);
        assert.throws(()=>requireRetainedAuthoredPawMotion(r.beforeMotion,r.originalMotion),/authored paw movement lost/);
        requireRetainedAuthoredPawMotion(r.afterMotion,r.originalMotion);
        for(const name of ['gallop_jump','death','entrance','victory'])assert.equal(r.beforeMotion.find(c=>c.clip===name).frozenLimbChannels,0);
    });
    test(`Oni ${r.stage}: exact sculpt, topology, all skin attributes, original joint frames, bind matrices and texture payloads remain intact`,()=>{
        const a=r.before.meshes[0],b=r.after.meshes[0];assert.deepEqual(r.after.json.nodes,r.before.json.nodes);
        assert.deepEqual(a.geometry.index.array,b.geometry.index.array);
        for(const name of Object.keys(a.geometry.attributes))assert.deepEqual(a.geometry.attributes[name].array,b.geometry.attributes[name].array,name);
        a.skeleton.boneInverses.forEach((m,i)=>assert.deepEqual(m.toArray(),b.skeleton.boneInverses[i].toArray()));
        for(const name of ['materials','textures','samplers'])assert.deepEqual(r.after.json[name],r.before.json[name]);
        r.before.json.images.forEach((img,i)=>{const a=r.before.json.bufferViews[img.bufferView],b=r.after.json.bufferViews[r.after.json.images[i].bufferView];assert.deepEqual(r.before.binary.subarray(a.byteOffset,a.byteOffset+a.byteLength),r.after.binary.subarray(b.byteOffset,b.byteOffset+b.byteLength));});
    });
    test(`Oni ${r.stage}: every existing curve in all thirteen clips, including unrelated head, tail, gait, attack and body curves, remains byte-equivalent after decoding`,()=>{
        for(const clip of r.before.animations){const after=r.after.animations.find(c=>c.name===clip.name);assert.equal(after.duration,clip.duration);
            for(const track of clip.tracks){const actual=after.tracks.find(t=>t.name===track.name);assert.ok(actual);assert.equal(actual.getInterpolation(),track.getInterpolation());assert.deepEqual(actual.times,track.times);assert.deepEqual(actual.values,track.values);}
            if(!OMITTED_FITTED_PERFORMANCE_CLIPS.includes(clip.name))assert.equal(after.tracks.length,clip.tracks.length);
        }
    });
    test(`Oni ${r.stage}: no invented hind-paw performance in death, whose original authored leg contribution is forepaw-only`,()=>{
        const a=r.originalMotion.find(c=>c.clip==='death'),b=r.afterMotion.find(c=>c.clip==='death');
        for(const p of ['frontL','frontR']){assert.ok(a.patches[p].maxLimbContribution>.1);assert.ok(b.patches[p].maxLimbContribution>.1);}
        for(const p of ['hindL','hindR']){assert.equal(a.patches[p].maxLimbContribution,0);assert.equal(b.patches[p].maxLimbContribution,0);}
        assert.equal(b.frozenLimbChannels,2);
    });
}
test('Oni anatomical source masks reject a tail/face vertex even when the fitted skin would assign it to a paw',()=>{
    const contaminated=structuredClone(regions),mesh=original.meshes[0];let index=-1;
    for(let v=0;v<mesh.geometry.attributes.position.count;v++){const p=mesh.getVertexPosition(v,new T.Vector3()).applyMatrix4(mesh.matrixWorld);if(p.z<-.3){index=v;break;}}
    assert.ok(index>=0);contaminated.frontL.indices.push(index);
    assert.throws(()=>selectVisibleSoleRegions(original,contaminated,{original}),/contaminates frozen box/);
    assert.deepEqual(Object.values(regions).map(p=>p.indices.length),[215,214,233,222]);
    assert.deepEqual(Object.values(cases[1].selection).map(p=>p.indices.length),[112,120,118,121]);
});
test('Oni retarget is deterministic, pinned to reviewed inputs, and rejects repeated repair',async()=>{
    for(const r of cases){assert.deepEqual((await retargetFittedPetPerformances(r.beforeBytes,{expectedSha256:r.pin})).bytes,r.candidate.bytes);
        await assert.rejects(()=>retargetFittedPetPerformances(Buffer.from('wrong'),{expectedSha256:r.pin}),/Unexpected fitted performance source/);
        await assert.rejects(()=>retargetFittedPetPerformances(r.candidate.bytes,{expectedSha256:r.candidate.report.sha256}),/already authored/);
    }
    assert.equal(cases[0].candidate.report.sha256,'267989e9d70d963616798ee87c55d6887e9680a864c53febebd84ac61062cd96');
});
test('Restored performances remain inside the authoring source-retention boundary',()=>{
    for(const r of cases){const j=r.after.json,b=j.extras.properAnimationSourceBoundary;
        assert.equal(b.binLength,r.after.binary.length);assert.equal(b.accessorCount,j.accessors.length);assert.equal(b.bufferViewCount,j.bufferViews.length);
        for(const clip of j.animations)for(const s of clip.samplers)for(const i of [s.input,s.output])assert.ok(i<b.accessorCount);
    }
});
for(const stage of ['source','battle'])test(`Oni shipping ${stage}: actual generated asset retains independently measured authored paw performances across the complete bank`,async()=>{
    const model=await loadPetDeformationProbe(new URL(`../public/pet-models/${stage==='battle'?'warfront-lod/':''}roster/mythic-4.glb`,import.meta.url));
    const selected=selectVisibleSoleRegions(model,regions,{original,stage});
    const measured=measureVisibleLimbPerformances(model,selected),reference=cases.find(r=>r.stage===stage);
    assert.equal(measured.length,13);requireRetainedAuthoredPawMotion(measured,reference.originalMotion);
    if(stage==='source')assert.equal(model.sha256,reference.candidate.report.sha256);
    // LOD generation can repack accessors; decoded pose curves must match.
    for(const clip of reference.after.animations){const actual=model.animations.find(c=>c.name===clip.name);assert.equal(actual.tracks.length,clip.tracks.length);for(const t of clip.tracks){const u=actual.tracks.find(u=>u.name===t.name);assert.ok(u);assert.deepEqual(u.times,t.times);assert.deepEqual(u.values,t.values);}}
});
