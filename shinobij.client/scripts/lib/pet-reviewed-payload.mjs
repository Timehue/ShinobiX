// Old authoring receipts pin a binary prefix. A later reviewed repair compacts
// that prefix, so its replacement invariant is the complete approved asset hash.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve,relative} from 'node:path';
import {runtimePetModels} from './pet-runtime-audit.mjs';
import {PET_REVIEW_CLIPS} from '../check-pet-shape-review.mjs';
const client=resolve(import.meta.dirname,'../..'),modelRoot=resolve(client,'public/pet-models');
const receipts=JSON.parse(await readFile(resolve(client,'../docs/audits/pet-animation-shape-reviews.json'))).pets;
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
export function assertPayloadPreservedOrReviewed(path,bytes,json,bin,proof){
    if(json.extras?.pebbleDistinctRebuild){assertReviewedDistinctPebblePayload(path,bytes,json);return;}
    const prefix=sha(bin.subarray(0,proof.preservedPayloadBytes));
    if(prefix===proof.preservedPayloadSha256)return;
    assert.ok(json.extras?.reviewedSkullRepair||json.extras?.skullBindingRepair||json.extras?.reviewedRigScaleRepair||json.extras?.reviewedDetachedFragmentCleanup,`${path}: unreviewed payload change`);
    const row=runtimePetModels.find(row=>resolve(path)===resolve(row.path)||resolve(path)===resolve(modelRoot,'warfront-lod',relative(modelRoot,row.path)));
    assert.ok(row,`${path}: changed payload is not a reviewed runtime asset`);
    const receipt=receipts[row.pet.id];assert.ok(receipt,`${path}: missing full review receipt`);
    const stage=resolve(path)===resolve(row.path)?'sha256':'lodSha256';
    assert.equal(sha(bytes),receipt[stage],`${path}: repaired payload changed after complete visual review`);
    assert.ok(receipt.reviewer&&receipt.reviewedAt&&receipt.fullBodyReviewed&&receipt.skullShapeReviewed&&receipt.transitionsReviewed,`${path}: incomplete review`);
    assert.deepEqual(receipt.clips,PET_REVIEW_CLIPS);assert.deepEqual(receipt.views,['front','side']);
}

// Pebble's new sculpt deliberately replaces obsolete prefix receipts. Require
// the exact twice-reviewed source/LOD and complete visual evidence instead.
export function assertReviewedDistinctPebblePayload(path,bytes,json){
    const row=runtimePetModels.find(row=>row.pet.id==='starter-earth'&&(resolve(path)===resolve(row.path)||resolve(path)===resolve(modelRoot,'warfront-lod',relative(modelRoot,row.path))));
    assert.ok(row,'Distinct rebuild is only approved for Pebble runtime assets');
    const recipe=json.extras?.pebbleDistinctRebuild;
    assert.equal(recipe?.sourceSha256,'0a1706f3bfbe4399202530b788c5b1573ceecaf6a345fa38296e389f4c5feae5');
    assert.equal(recipe?.sharedStoneTurtleGeometry,false);
    assert.equal(recipe?.removedCapTriangles,2499);assert.equal(recipe?.scalpVertices,1006);
    const stage=resolve(path)===resolve(row.path)?'sha256':'lodSha256',receipt=receipts['starter-earth'];
    assert.equal(sha(bytes),stage==='sha256'?'c99b0471489b65a5fe2c4b9b50bf781c48f4820f7eacdb092cf983a15ca51894':'64524351ebb7534dd603645a6d8015ec745829d9bfa75ced0a8a9340e725f0b3','Reviewed distinct Pebble payload is stale');
    assert.equal(sha(bytes),receipt?.[stage]);
    assert.ok(receipt.reviewer&&receipt.reviewedAt&&receipt.fullBodyReviewed&&receipt.skullShapeReviewed&&receipt.transitionsReviewed&&receipt.independentFullFaceReviewed);
    assert.equal(receipt.companionIdleFramesReviewed,24);assert.equal(receipt.equippedTechniqueFramesReviewed,216);
    assert.deepEqual(receipt.clips,PET_REVIEW_CLIPS);assert.deepEqual(receipt.views,['front','side']);
}
