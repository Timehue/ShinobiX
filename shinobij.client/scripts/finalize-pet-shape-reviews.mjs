// Package already completed inspections. This script cannot create a visual pass.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,relative,dirname,basename} from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {runtimePetModels} from './lib/pet-runtime-audit.mjs';
import {PET_REVIEW_CLIPS,petReviewRendererSha256,petReviewEvidenceFailures} from './check-pet-shape-review.mjs';
const ids=process.argv.find(v=>v.startsWith('--model='))?.slice(8).split(',');assert.ok(ids?.length,'Explicit completed IDs are required');
const client=resolve(import.meta.dirname,'..'),repo=resolve(client,'..'),ledgerPath=resolve(repo,'docs/audits/pet-animation-visual-review-progress.json');
const ledger=JSON.parse(await readFile(ledgerPath)),index=JSON.parse(await readFile(resolve(client,'.tmp/pet-reviewed-skulls/current-source-battle-index.json')));
const receiptPath=resolve(repo,'docs/audits/pet-animation-shape-reviews.json'),receipts=JSON.parse(await readFile(receiptPath));
const output=resolve(repo,'docs/screenshots/pet-shape-2026-10-15');await mkdir(output,{recursive:true});
const sha=bytes=>createHash('sha256').update(bytes).digest('hex'),rendererSha256=await petReviewRendererSha256(repo);
const reportCache=new Map();
async function reportFor(evidence){
 if(!reportCache.has(evidence.report)){
  const bytes=await readFile(resolve(repo,evidence.report));assert.equal(sha(bytes),evidence.reportSha256,'Numeric evidence changed');reportCache.set(evidence.report,JSON.parse(bytes));
 }
 return reportCache.get(evidence.report);
}
for(const id of ids){
 const row=runtimePetModels.find(r=>r.pet.id===id),progress=ledger.pets[id];assert.ok(row&&progress);
 const sourceHash=sha(await readFile(row.path)),local=relative(resolve(client,'public/pet-models'),row.path),battleHash=sha(await readFile(resolve(client,'public/pet-models/warfront-lod',local)));
 const runtime=progress.runtimeVisualPass;assert.ok(runtime,`${id}: runtime images have not been inspected`);
 assert.equal(runtime.sourceSha256,sourceHash);assert.equal(runtime.battleSha256,battleHash);assert.equal(runtime.rendererSha256,rendererSha256);
 assert.equal(runtime.rows.length,16);assert.equal(runtime.phases.length,6);assert.deepEqual(runtime.views,['front','side']);
 assert.deepEqual(await petReviewEvidenceFailures(repo,runtime),[]);
 const evidence=[],evidenceSha256={},metrics={},findings={runtime:runtime.finding};
 async function save(name,bytes){const file=resolve(output,`${id}-${name}`);await writeFile(file,bytes);const path=relative(repo,file).replaceAll('\\','/');evidence.push(path);evidenceSha256[path]=sha(bytes);}
 for(const [stage,hash,pass] of [['source',sourceHash,progress.secondPassSource],['battle',battleHash,progress.secondPassBattle]]){
  assert.ok(pass,`${id}: ${stage} second inspection missing`);assert.equal(pass.sha256,hash);assert.deepEqual(pass.clips,PET_REVIEW_CLIPS);assert.equal(pass.progress.length,6);
  assert.deepEqual(await petReviewEvidenceFailures(repo,pass),[]);findings[stage]=pass.finding;
  const labels=[...new Set(pass.evidence.map(file=>dirname(file)))];let head=0,body=0;
  for(const directory of labels){
   const label=basename(directory),isHead=pass.evidence.some(file=>dirname(file)===directory&&file.endsWith('-head-front.webp'));
   const compact=resolve(repo,dirname(directory),`compact-${label}`,`${id}-${isHead?'heads':'body'}.webp`);
   await save(`${stage}-clips-${isHead?`head-${++head}`:`body-${++body}`}.webp`,await readFile(compact));
  }
  assert.ok(head>=1&&body===1);
  const numeric=index.pets.find(p=>p.id===id&&p.stage===stage);assert.ok(numeric?.skull&&numeric.geometry);assert.equal(numeric.sha256,hash);
  const skull=(await reportFor(numeric.skull)).pets.find(p=>p.id===id&&p.sha256===hash),geometry=(await reportFor(numeric.geometry)).pets.find(p=>p.id===id&&p.assetSha256===hash);
  assert.ok(skull&&geometry);assert.equal(skull.failed,false);assert.equal(skull.blendPoses,468);assert.ok(geometry.clips.every(c=>c.samples.every(s=>s.severeEdges===0)));
  metrics[stage]={sha256:hash,skull,geometry};
 }
 for(const file of runtime.evidence)await save(`runtime-${basename(file).slice(id.length+1)}`,await readFile(resolve(repo,file)));
 await save('numeric-evidence.json',Buffer.from(JSON.stringify({id,rendererSha256,metrics},null,2)+'\n'));
 const atlasHash=sha(await readFile(resolve(client,'public/pet-models/warfront-impostors',local.replace(/\.glb$/,'.webp'))));
 receipts.pets[id]={sha256:sourceHash,lodSha256:battleHash,atlasSha256:atlasHash,rendererSha256,reviewer:'Codex visual inspection',reviewedAt:runtime.reviewedAt,clips:PET_REVIEW_CLIPS,views:['front','side'],fullBodyReviewed:true,skullShapeReviewed:true,transitionsReviewed:true,evidence,evidenceSha256,findings,limits:'All 13 raw clips inspected twice with front and side head/body views; final pass uses six alternate phases. Production renderer inspected through 16 continuous state/transition rows at six phases in both assets. Dense skull/world-edge and all-geometry probes supplement visual review; this does not claim exhaustive coverage of every possible gameplay state.'};
 progress.finalReceipt={sourceSha256:sourceHash,battleSha256:battleHash,atlasSha256:atlasHash,rendererSha256,evidence,packagedAt:new Date().toISOString()};progress.secondPass='complete';progress.firstPass=progress.promotedSha256?'repaired-and-double-checked':'reviewed-no-additional-repair-needed';
}
receipts.schema=2;await writeFile(receiptPath,JSON.stringify(receipts,null,2)+'\n');await writeFile(ledgerPath,JSON.stringify(ledger,null,2)+'\n');
console.log(`Packaged final receipts and durable evidence for ${ids.length} completed inspections.`);
