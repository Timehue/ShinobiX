import { readFile,writeFile,mkdir,copyFile } from 'node:fs/promises';
import { resolve,relative,dirname } from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { runtimePetModels } from './lib/pet-runtime-audit.mjs';
import { loadPetDeformationProbe } from './lib/pet-deformation-probe.mjs';
import { parseStudioGlb } from './lib/pet-studio-glb.mjs';
import { normalizeReviewedPetRigScale } from './normalize-reviewed-pet-rig-scale.mjs';
import { repairAsset } from './repair-pet-skin-seams.mjs';
const root=resolve(import.meta.dirname,'..'),modelRoot=resolve(root,'public/pet-models');
const ids=process.argv.find(a=>a.startsWith('--model='))?.slice(8).split(',');
if(!ids?.length)throw Error('Select only visually reviewed repair candidates');
const ledgerPath=resolve(root,'../docs/audits/pet-animation-visual-review-progress.json'),ledger=JSON.parse(await readFile(ledgerPath));
const manifestPath=resolve(modelRoot,'roster-manifest.json'),manifest=JSON.parse(await readFile(manifestPath));
for(const id of ids) {
    const review=ledger.pets[id];if(review?.firstPass!=='candidate-visually-reviewed')throw Error(`${id}: visual candidate review missing`);
    const row=runtimePetModels.find(r=>r.pet.id===id),local=relative(modelRoot,row.path),candidate=resolve(root,'.tmp/pet-skull-candidates',local);
    const after=await loadPetDeformationProbe(candidate),current=await loadPetDeformationProbe(row.path);
    const backup=resolve(root,'.tmp/pet-skull-originals',local);
    // Recover an interrupted manifest write without replacing the original backup
    // with the repaired model. All review and conservation checks still run.
    const sourceAlreadyPromoted=current.sha256===after.sha256;
    let before=sourceAlreadyPromoted?await loadPetDeformationProbe(backup):current;
    const rigBackup=resolve(root,'.tmp/pet-rig-originals',local);
    if(review.rigNormalization){
        const receipt=review.rigNormalization;
        const originalPath=sourceAlreadyPromoted?rigBackup:row.path;
        const original=sourceAlreadyPromoted?await loadPetDeformationProbe(originalPath):current;
        assert.equal(original.sha256,receipt.sourceSha256,`${id}: original rig changed`);
        let replay=resolve(root,'.tmp/pet-rig-promotion-check',local);
        const normalized=await normalizeReviewedPetRigScale(originalPath,replay);
        const passes=receipt.seamRepair?[receipt.seamRepair,...(receipt.seamRepair.passes??[])]:[];
        assert.equal(normalized.sha256,passes[0]?.sourceSha256??receipt.sha256,`${id}: rig normalization is not reproducible`);
        for(const [i,pass]of passes.entries()){
            assert.equal((await loadPetDeformationProbe(replay)).sha256,pass.sourceSha256,`${id}: seam source changed`);
            const next=resolve(root,`.tmp/pet-rig-promotion-check-seam-${i}`,local);
            await repairAsset(replay,next,0,pass.pairs);replay=next;
        }
        before=await loadPetDeformationProbe(replay);
        assert.equal(before.sha256,receipt.sha256,`${id}: normalized rig/seams are not reproducible`);
        assert.equal(before.sha256,(await loadPetDeformationProbe(resolve(root,receipt.path))).sha256,`${id}: normalized inspection artifact changed`);
        assert.ok(receipt.maxBindError<2e-5,`${id}: rig normalization changed bind appearance`);
    }
    assert.equal(after.sha256,review.candidateSha256,`${id}: candidate changed after review`);
    assert.equal(before.sha256,after.json.extras.reviewedSkullRepair.sourceSha256,`${id}: source changed after repair`);
    let numericEvidence,fullMeshEvidence;
    for(const evidence of review.numericChecks??[]){
        const report=JSON.parse(await readFile(resolve(root,'..',evidence)));
        const result=report.pets?.find(p=>p.id===id&&p.sha256===after.sha256);
        if(result?.clips&&result.blendPoses>=468)numericEvidence=result;
        const geometryResult=report.pets?.find(p=>p.id===id&&p.assetSha256===after.sha256);
        if(geometryResult?.geometryCoverage?.startsWith('all vertices')&&!report.deformationWarnings?.some(w=>w.id===id)&&!report.failures?.some(f=>f.id===id))fullMeshEvidence=geometryResult;
    }
    assert.ok(numericEvidence,`${id}: current dense skull/blend evidence missing`);
    assert.ok(fullMeshEvidence,`${id}: current full geometry evidence missing or failed`);
    assert.equal(numericEvidence.failed,false,`${id}: candidate skull probe failed`);
    for(const field of ['blendDrift','blendWorldMinRatio','blendWorldMaxRatio'])assert.ok(Number.isFinite(numericEvidence[field]),`${id}: current world-space blend metric missing`);
    assert.deepEqual(numericEvidence.clips.map(c=>c.clip),review.clips,`${id}: incomplete numeric clip coverage`);
    for(const clip of numericEvidence.clips)for(const field of ['maxDrift','minRatio','maxRatio','worldMinRatio','worldMaxRatio'])assert.ok(Number.isFinite(clip[field]),`${id}: non-finite shape metric`);
    assert.equal(before.meshes.length,after.meshes.length);
    for(let i=0;i<before.meshes.length;i++){
        for(const name of ['position','normal','uv'])assert.deepEqual(before.meshes[i].geometry.attributes[name].array,after.meshes[i].geometry.attributes[name].array);
        assert.deepEqual(before.meshes[i].geometry.index.array,after.meshes[i].geometry.index.array);
    }
    const repair=after.json.extras.reviewedSkullRepair,maskMatrix=new THREE.Matrix4().fromArray(repair.envelopeMatrix);
    const oldAttributes=before.meshes[0].geometry.attributes,newAttributes=after.meshes[0].geometry.attributes,point=new THREE.Vector3();
    for(let v=0;v<oldAttributes.position.count;v++){
        point.fromBufferAttribute(oldAttributes.position,v).applyMatrix4(maskMatrix);
        if(!repair.region.exclude?.some(box=>point.x>=box[0]&&point.x<=box[1]&&point.y>=box[2]&&point.y<=box[3]&&point.z>=box[4]&&point.z<=box[5]))continue;
        for(let slot=0;slot<4;slot++)for(const name of ['skinIndex','skinWeight'])assert.equal(newAttributes[name].getComponent(v,slot),oldAttributes[name].getComponent(v,slot),`${id}: excluded accessory binding changed at vertex ${v}`);
    }
    assert.deepEqual(before.json.nodes,after.json.nodes);assert.equal(before.animations.length,after.animations.length);
    for(let i=0;i<before.animations.length;i++){
        const a=before.animations[i],b=after.animations[i];assert.equal(a.name,b.name);assert.equal(a.tracks.length,b.tracks.length);
        for(let j=0;j<a.tracks.length;j++){assert.equal(a.tracks[j].name,b.tracks[j].name);assert.deepEqual(a.tracks[j].times,b.tracks[j].times);assert.deepEqual(a.tracks[j].values,b.tracks[j].values);}
    }
    const oldBytes=await readFile(review.rigNormalization?resolve(root,review.rigNormalization.path):(sourceAlreadyPromoted?backup:row.path)),newBytes=await readFile(candidate);
    const imageStreams=bytes=>{const {json,bin}=parseStudioGlb(bytes);return (json.images??[]).map(image=>{if(image.uri)return image.uri;const view=json.bufferViews[image.bufferView];return bin.subarray(view.byteOffset??0,(view.byteOffset??0)+view.byteLength);});};
    assert.deepEqual(imageStreams(oldBytes),imageStreams(newBytes));
    if(!sourceAlreadyPromoted){
        await mkdir(dirname(backup),{recursive:true});
        if(review.rigNormalization){await mkdir(dirname(rigBackup),{recursive:true});await copyFile(row.path,rigBackup);await copyFile(resolve(root,review.rigNormalization.path),backup);}
        else await copyFile(row.path,backup);
        await copyFile(candidate,row.path);
    }
    if(manifest.entries[row.model.visualId]){const entry=manifest.entries[row.model.visualId];entry.sha256=createHash('sha256').update(newBytes).digest('hex').toUpperCase();entry.validation.bytes=newBytes.length;entry.reviewedSkullRepair=after.json.extras.reviewedSkullRepair;}
    review.firstPass='promoted-pending-double-check';review.promotedSha256=after.sha256;review.conservation=review.rigNormalization?'geometry, topology, atlas, clip names/times preserved; rig scale, rest frames and animation deltas deterministically retargeted; localized seam and skull binding repaired':'geometry, topology, atlas, bone nodes and all animation curves unchanged';
    console.log(`Promoted ${id} after exact conservation checks`);
}
await writeFile(manifestPath,JSON.stringify(manifest,null,2)+'\n');await writeFile(ledgerPath,JSON.stringify(ledger,null,2)+'\n');
