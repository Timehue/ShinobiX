import test from 'node:test';
import assert from 'node:assert/strict';
import { petShapeReviewFailures, petReviewEvidenceFailures, PET_REVIEW_CLIPS } from './check-pet-shape-review.mjs';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,dirname,basename} from 'node:path';
import {createHash} from 'node:crypto';
const model = { id:'mythic-4',sha256:'current-asset' };
const review = { sha256:model.sha256, reviewer:'visual reviewer',reviewedAt:'2026-10-14',evidence:['all-clip-gallery'],clips:PET_REVIEW_CLIPS,views:['front','side'],fullBodyReviewed:true,skullShapeReviewed:true,transitionsReviewed:true };
test('a model replacement cannot inherit its old visual approval',()=>{
    assert.deepEqual(petShapeReviewFailures([model],{[model.id]:review}),[]);
    assert.match(petShapeReviewFailures([{...model,sha256:'new-animation'}],{[model.id]:review})[0],/changed after review/);
    assert.match(petShapeReviewFailures([{...model,lodSha256:'new-battle-mesh'}],{[model.id]:review})[0],/battle model changed/);
    assert.match(petShapeReviewFailures([{...model,rendererSha256:'new-shader'}],{[model.id]:review})[0],/renderer changed/);
    assert.match(petShapeReviewFailures([{...model,atlasSha256:'new-sprite-animation'}],{[model.id]:review})[0],/impostor changed/);
});

test('missing, replaced and untracked inspection evidence cannot pass the review gate',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'pet-review-evidence-'));
 try{
  const bytes=Buffer.from('actually reviewed image bytes'),path='sheet.webp';await writeFile(join(directory,path),bytes);
  const receipt={evidence:[path],evidenceSha256:{[path]:createHash('sha256').update(bytes).digest('hex')}};
  assert.deepEqual(await petReviewEvidenceFailures(directory,receipt),[]);
  await writeFile(join(directory,path),'replacement');assert.match((await petReviewEvidenceFailures(directory,receipt))[0],/changed after inspection/);
  assert.match((await petReviewEvidenceFailures(directory,{evidence:[path]}))[0],/fingerprint missing/);
  assert.match((await petReviewEvidenceFailures(directory,{evidence:['../outside.webp']}))[0],/leaves repository/);
  assert.match((await petReviewEvidenceFailures(directory,{evidence:['absent.webp'],evidenceSha256:{'absent.webp':'a'.repeat(64)}}))[0],/evidence missing/);
 }finally{assert.equal(dirname(resolve(directory)),resolve(tmpdir()));assert.ok(basename(directory).startsWith('pet-review-evidence-'));await rm(directory,{recursive:true,force:true});}
});
test('missing pets, skipped clips and missing views fail closed',()=>{
    assert.match(petShapeReviewFailures([model],{})[0],/no animation shape review/);
    assert.ok(petShapeReviewFailures([model],{[model.id]:{...review,clips:PET_REVIEW_CLIPS.slice(1)}}).length);
    assert.ok(petShapeReviewFailures([model],{[model.id]:{...review,views:['front']}}).length);
    assert.ok(petShapeReviewFailures([model],{[model.id]:{...review,transitionsReviewed:false}}).length);
});
