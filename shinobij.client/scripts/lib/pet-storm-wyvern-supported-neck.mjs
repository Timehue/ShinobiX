import {createHash} from 'node:crypto';
import {parseStudioGlb,encodeStudioGlb} from './pet-studio-glb.mjs';
import {applyReviewedAnimationClearance} from './pet-animation-clearance.mjs';
import {compactGlbDelivery} from '../compact-glb-delivery.mjs';

// Keep the pinned complete jaw and reduce the four independently observed
// opposing neck excursions. Root, limbs, wings and all other curves stay authored.
// The experiment provenance key is retained for exact candidate replay.
export async function repairStormWyvernSupportedNeck(source) {
    const sourceSha256=createHash('sha256').update(source).digest('hex');
    if(sourceSha256!=='68d68f65c4b042197697d40bfa1d6ce7585593c80ecfb25316a081fd8da6e22d')throw Error('Unexpected Storm Wyvern complete-jaw source');
    const {json,bin}=parseStudioGlb(source);let binary=bin;const configs=[];
    for(const clip of ['idle_2','idle_hitreact1','death','victory']) {
        const c={clip,bones:['head','neck',...(clip==='death'?['chest']:clip==='idle_hitreact1'?['spine']:[])],rotationExcursion:.25,reason:'Candidate: reduce opposing upper-neck excursions behind the fixed complete jaw to avoid the independently observed upper-throat fold; retain authored body, root, limb and wing motion.'};
        binary=await applyReviewedAnimationClearance(json,binary,c);configs.push(c);
    }
    const report={sourceSha256,configs};json.extras.stormWyvernSupportedNeckExperiment=report;
    const out=parseStudioGlb(compactGlbDelivery(encodeStudioGlb(json,binary)));
    out.json.extras.properAnimationSourceBoundary={binLength:out.bin.length,accessorCount:out.json.accessors.length,bufferViewCount:out.json.bufferViews.length};
    return {bytes:encodeStudioGlb(out.json,out.bin),report};
}
