import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {resolve,relative} from 'node:path';
import {runtimePetModels} from './lib/pet-runtime-audit.mjs';
import {parseStudioGlb} from './lib/pet-studio-glb.mjs';
import {petReviewRendererSha256} from './check-pet-shape-review.mjs';
const repo=resolve(import.meta.dirname,'../..'),base='90da9d5318b0c240f8a2668d3a1179fa0ade9cbc';
const hash=b=>createHash('sha256').update(b).digest('hex'),normalized=b=>b.toString().replaceAll('\r\n','\n');
const proof=JSON.parse(await readFile(resolve(repo,'docs/audits/pet-azure-terminal-renderer-compatibility-2026-10-21.json')));
const release=JSON.parse(await readFile(resolve(repo,'docs/audits/pet-terminal-sol-release-2026-10-21.json')));
const revised=new Set(release.pets.map(p=>p.id));assert.equal(revised.size,5);
for(const file of proof.rendererFiles){
    const prior=execFileSync('git',['show',`${base}:${file.path}`],{cwd:repo,maxBuffer:4*1024*1024});
    assert.equal(hash(normalized(prior)),file.baselineSha256);
    assert.equal(hash(normalized(await readFile(resolve(repo,file.path)))),file.currentSha256);
}
assert.equal(await petReviewRendererSha256(repo),proof.currentRendererSha256);
const groundHelper=await readFile(resolve(repo,proof.groundContactHelper.path),'utf8');
// This single type annotation erases to identical JavaScript; all prior sampling
// expressions remain byte-for-byte unchanged. Retain the original visual proof.
assert.equal(hash(Buffer.from(groundHelper.replace('exact: boolean | 1 = false','exact = false'))),proof.groundContactHelper.sha256);
const receipts=JSON.parse(execFileSync('git',['show',`${base}:docs/audits/pet-animation-shape-reviews.json`],{cwd:repo,maxBuffer:16*1024*1024})).pets;
const unchanged=[];
for(const row of runtimePetModels){
    if(revised.has(row.pet.id))continue;
    const receipt=receipts[row.pet.id];assert.equal(receipt.rendererSha256,proof.priorRendererSha256);
    const local=relative(resolve(repo,'shinobij.client/public/pet-models'),row.path),assets=[];
    for(const [stage,path]of [['source',row.path],['battle',resolve(repo,'shinobij.client/public/pet-models/warfront-lod',local)]]){
        const bytes=await readFile(path),sha256=hash(bytes);
        assert.equal(sha256,stage==='source'?receipt.sha256:receipt.lodSha256,`${row.pet.id}/${stage}: visual receipt no longer matches`);
        assert.notEqual(parseStudioGlb(bytes).json.extras?.deathPoseRepair?.revision,'20261021-azure-terminal-collapse-v3');
        assets.push({stage,path:relative(repo,path).replaceAll('\\','/'),sha256});
    }
    unchanged.push({id:row.pet.id,assets});
}
assert.equal(unchanged.length,156);
const report={baselineCommit:base,priorRendererSha256:proof.priorRendererSha256,rendererSha256:proof.currentRendererSha256,proof:'docs/audits/pet-azure-terminal-renderer-compatibility-2026-10-21.json',proofSha256:hash(await readFile(resolve(repo,'docs/audits/pet-azure-terminal-renderer-compatibility-2026-10-21.json'))),unchangedIdentities:unchanged.length,unchanged,reviewedSeparately:release.pets,scope:'Exact prior assets without activating metadata keep their old renderer behavior. New five assets retain separately captured full visual reviews. This compatibility proof does not approve unresolved art or claim fresh visual inspection of unchanged pets.'};
await writeFile(resolve(repo,'docs/audits/pet-terminal-release-renderer-compatibility-2026-10-21.json'),JSON.stringify(report,null,2)+'\n');
console.log({unchanged:unchanged.length,reviewedSeparately:revised.size,renderer:report.rendererSha256});
