// Record only IDs whose complete image sheets have actually been inspected.
// This progress record never issues a final animation-shape approval receipt.
import {readFile,writeFile} from 'node:fs/promises';
import {resolve,relative} from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {runtimePetModels} from './lib/pet-runtime-audit.mjs';
import {PET_REVIEW_CLIPS} from './check-pet-shape-review.mjs';
const arg=k=>process.argv.find(v=>v.startsWith(`--${k}=`))?.slice(k.length+3);
const ids=arg('model')?.split(','),stage=arg('stage'),headLabel=arg('head-label'),bodyLabel=arg('body-label'),finding=arg('finding');
const extraHeadLabels=arg('extra-head-label')?.split(',').filter(Boolean)??[];
assert.ok(ids?.length&&['source','battle'].includes(stage)&&headLabel&&bodyLabel&&finding,'Explicit reviewed IDs, stage, capture labels and visual finding are required');
const root=resolve(import.meta.dirname,'..'),repo=resolve(root,'..'),ledgerPath=resolve(repo,'docs/audits/pet-animation-visual-review-progress.json');
const ledger=JSON.parse(await readFile(ledgerPath));
const head=JSON.parse(await readFile(resolve(root,'.tmp/pet-shape-review',headLabel,'manifest.json'))),body=JSON.parse(await readFile(resolve(root,'.tmp/pet-shape-review',bodyLabel,'manifest.json')));
const extraHeads=await Promise.all(extraHeadLabels.map(async label=>({label,manifest:JSON.parse(await readFile(resolve(root,'.tmp/pet-shape-review',label,'manifest.json')))})));
for(const id of ids){
 const row=runtimePetModels.find(r=>r.pet.id===id),h=head.pets.find(p=>p.id===id),b=body.pets.find(p=>p.id===id);assert.ok(row&&h&&b,`${id}: incomplete captured review`);
 const path=stage==='source'?row.path:resolve(root,'public/pet-models/warfront-lod',relative(resolve(root,'public/pet-models'),row.path));
 const sha256=createHash('sha256').update(await readFile(path)).digest('hex');assert.equal(h.sha256,sha256,`${id}: head evidence is stale`);assert.equal(b.sha256,sha256,`${id}: body evidence is stale`);
 assert.deepEqual(h.clips,PET_REVIEW_CLIPS);assert.deepEqual(b.clips,PET_REVIEW_CLIPS);assert.deepEqual(h.progress,b.progress);assert.ok(h.progress.length>=6&&h.progress.includes(.125)&&h.progress.includes(.375),`${id}: second pass requires different phases`);
 const evidence=['head-front','head-side'].map(v=>`shinobij.client/.tmp/pet-shape-review/${headLabel}/${id}-${v}.webp`).concat(['front','side'].map(v=>`shinobij.client/.tmp/pet-shape-review/${bodyLabel}/${id}-${v}.webp`));
 for(const {label,manifest} of extraHeads){
  const extra=manifest.pets.find(p=>p.id===id);assert.ok(extra,`${id}: missing supplemental face capture`);
  assert.equal(extra.sha256,sha256,`${id}: supplemental face evidence is stale`);assert.deepEqual(extra.clips,PET_REVIEW_CLIPS);assert.deepEqual(extra.progress,h.progress);assert.deepEqual(extra.views,h.views);
  evidence.push(...['head-front','head-side'].map(v=>`shinobij.client/.tmp/pet-shape-review/${label}/${id}-${v}.webp`));
 }
 const evidenceSha256={};for(const file of evidence)evidenceSha256[file]=createHash('sha256').update(await readFile(resolve(repo,file))).digest('hex');
 ledger.pets[id][stage==='source'?'secondPassSource':'secondPassBattle']={sha256,clips:h.clips,progress:h.progress,headViews:h.views,bodyViews:b.views,evidence,evidenceSha256,finding,reviewedAt:new Date().toISOString(),reviewer:'Codex visual inspection'};
 ledger.pets[id].secondPass=ledger.pets[id].secondPassSource&&ledger.pets[id].secondPassBattle?'source-and-battle-reviewed-runtime-pending':`${stage}-reviewed-other-version-and-runtime-pending`;
}
await writeFile(ledgerPath,JSON.stringify(ledger,null,2)+'\n');console.log(`Recorded ${stage} second visual pass for ${ids.length} pets; runtime review remains pending.`);
