import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {parseStudioGlb,encodeStudioGlb} from './pet-studio-glb.mjs';

export const PEBBLE_REVIEWED_CANDIDATES={
    source:'c56b6391da217d8aa076c5cde6ea150b0eefa78b33d0ba347390e58001fc3a83',
    battle:'d0fbe8099f23b4ea619d5ecf866e758b2f017c4ad8266a03e2e0f8f101b520dc',
};
const sha=b=>createHash('sha256').update(b).digest('hex');

/** Finalize provenance only. Rendering, skin, textures and animation bytes
 * must remain exactly equal to the candidate that was actually inspected. */
export function finalizePebbleFullRemake(bytes,stage){
    assert.equal(sha(bytes),PEBBLE_REVIEWED_CANDIDATES[stage],'Uninspected Pebble candidate');
    const {json,bin}=parseStudioGlb(bytes),before=structuredClone(json);
    assert.equal(json.extras.pebbleFullRemake.privateCandidateOnly,true);
    json.extras.characterMotion.visibleSurfaceContacts='Source and battle production transitions, two technique timing passes and advancing companion idle reviewed';
    const remake=json.extras.pebbleFullRemake;
    remake.revision='20261019-full-sculpt-reviewed-v9';
    remake.privateCandidateOnly=false;
    remake.acceptance='double-visual-reviewed-awaiting-live-verification';
    remake.animations='Retained 13-clip rig with new anatomical skin weights and visible-surface ground calibration; independently reviewed twice';
    remake.reviewedCandidates=PEBBLE_REVIEWED_CANDIDATES;
    remake.review='docs/audits/pet-pebble-full-remake-v9-review-2026-10-19.json';
    remake.groundCalibration.productionApproval=true;
    const result=encodeStudioGlb(json,bin),after=parseStudioGlb(result);
    delete before.extras;const structural=structuredClone(after.json);delete structural.extras;
    assert.deepEqual(structural,before,'Release metadata changed render structure');
    assert.deepEqual(after.bin,bin,'Release metadata changed render payload');
    return {bytes:result,proof:{stage,candidateSha256:sha(bytes),releaseSha256:sha(result),binarySha256:sha(bin),jsonExceptRootExtrasIdentical:true,binaryIdentical:true}};
}
