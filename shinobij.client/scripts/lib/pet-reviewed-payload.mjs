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
    if(json.extras?.pebbleFullRemake){assertReviewedFullRemakePebblePayload(path,bytes,json);return;}
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

// The earlier detached-scalp attempt was explicitly rejected by the user.
export function assertReviewedDistinctPebblePayload(path,bytes,json){
    assert.fail(`${path}: rejected Pebble scalp replacement requires the complete new sculpt`);
}

// Complete sculpt replacement has a new topology and UV atlas. Its independent
// checks replace obsolete binary-prefix and bone-origin contact receipts.
export function assertReviewedFullRemakePebblePayload(path,bytes,json){
    const row=runtimePetModels.find(row=>row.pet.id==='starter-earth'&&(resolve(path)===resolve(row.path)||resolve(path)===resolve(modelRoot,'warfront-lod',relative(modelRoot,row.path))));
    assert.ok(row,'Full remake is only approved for Pebble runtime assets');
    const recipe=json.extras?.pebbleFullRemake;
    assert.equal(recipe?.revision,'20261019-full-sculpt-reviewed-v9');
    assert.equal(recipe?.privateCandidateOnly,false);
    assert.equal(recipe?.geometryEntirelyNew,true);assert.equal(recipe?.uvAtlasEntirelyNew,true);
    const stage=resolve(path)===resolve(row.path)?'sha256':'lodSha256',receipt=receipts['starter-earth'];
    assert.equal(sha(bytes),stage==='sha256'?'e3c992fa17abf531f99572620499560295a9a99b3d4518eee180f13a0b69890b':'0d32d4a122c8d5524a71489a420ed730986a95bce855bbe864b7dfb341f20bcc','Reviewed full remake Pebble payload is stale');
    assert.equal(sha(bytes),receipt?.[stage]);
    assert.notEqual(receipt.acceptance,'rejected-by-user');
    assert.ok(receipt.reviewer&&receipt.reviewedAt&&receipt.fullBodyReviewed&&receipt.skullShapeReviewed&&receipt.transitionsReviewed&&receipt.independentFullFaceReviewed);
    assert.equal(receipt.companionIdleFramesReviewed,24);assert.equal(receipt.equippedTechniqueFramesReviewed,216);
    assert.equal(receipt.fullRemakeReview?.faceRegions,13);assert.equal(receipt.fullRemakeReview?.exclusionMasks,false);
    assert.equal(receipt.fullRemakeReview?.rawVisualPasses,2);assert.equal(receipt.fullRemakeReview?.techniqueVisualPasses,2);
    assert.equal(receipt.fullRemakeReview?.completeSkinComponents,1);
    assert.deepEqual(receipt.clips,PET_REVIEW_CLIPS);assert.deepEqual(receipt.views,['front','side']);
}
