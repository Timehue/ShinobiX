// Call only after actually viewing every runtime sheet for these explicit IDs.
import {readFile,writeFile} from 'node:fs/promises';
import {resolve,relative} from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {runtimePetModels} from './lib/pet-runtime-audit.mjs';
import {petReviewRendererSha256} from './check-pet-shape-review.mjs';
const arg=k=>process.argv.find(v=>v.startsWith(`--${k}=`))?.slice(k.length+3);
const ids=arg('model')?.split(','),label=arg('label'),finding=arg('finding');
assert.ok(ids?.length&&label&&finding,'Explicit actually reviewed IDs, capture label and visual finding are required');
const client=resolve(import.meta.dirname,'..'),repo=resolve(client,'..'),directory=resolve(client,'.tmp/pet-shape-review',label);
const manifest=JSON.parse(await readFile(resolve(directory,'manifest.json'))),ledgerPath=resolve(repo,'docs/audits/pet-animation-visual-review-progress.json'),ledger=JSON.parse(await readFile(ledgerPath));
assert.equal(manifest.errors.length,0);assert.equal(manifest.rendererSha256,await petReviewRendererSha256(repo));assert.equal(manifest.rows.length,16);assert.equal(manifest.phases.length,6);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
for(const id of ids){
 const row=runtimePetModels.find(r=>r.pet.id===id),pet=manifest.pets.find(p=>p.id===id);assert.ok(row&&pet);assert.equal(pet.captures.length,2);
 const evidence=[],evidenceSha256={};
 for(const stage of ['source','battle']){
  const capture=pet.captures.find(c=>c.stage===stage);assert.ok(capture);assert.ok(capture.sheets.length>=2);
  const path=stage==='source'?row.path:resolve(client,'public/pet-models/warfront-lod',relative(resolve(client,'public/pet-models'),row.path));assert.equal(capture.sha256,sha(await readFile(path)),`${id}: stale ${stage} runtime capture`);
  for(const sheet of capture.sheets){const file=resolve(directory,sheet.name),hash=sha(await readFile(file));assert.equal(sheet.sha256,hash);const local=relative(repo,file).replaceAll('\\','/');evidence.push(local);evidenceSha256[local]=hash;}
 }
 ledger.pets[id].runtimeVisualPass={sourceSha256:pet.captures.find(c=>c.stage==='source').sha256,battleSha256:pet.captures.find(c=>c.stage==='battle').sha256,rendererSha256:manifest.rendererSha256,rows:manifest.rows.map(r=>r.name),phases:manifest.phases,views:manifest.views,evidence,evidenceSha256,finding,reviewer:'Codex visual inspection',reviewedAt:new Date().toISOString()};
 ledger.pets[id].secondPass='source-battle-and-runtime-reviewed-final-evidence-pending';
}
await writeFile(ledgerPath,JSON.stringify(ledger,null,2)+'\n');console.log(`Recorded actual production transition visual inspection for ${ids.length} pets. Final receipts remain separate.`);
