import {createHash} from 'node:crypto';
import {parseStudioGlb,encodeStudioGlb} from './pet-studio-glb.mjs';
import {applyReviewedAnimationClearance} from './pet-animation-clearance.mjs';
import {compactGlbDelivery} from '../compact-glb-delivery.mjs';

// The Kraken's facial tentacles share a continuous surface with its upper body.
// Keep the reviewed face binding and coordinate its upper-body excursions with
// that surface. Root, pelvis, legs, tail, translations, key times and sculpt stay
// authored. The experiment provenance key is retained for byte-exact replay of
// the separately captured candidate; approval belongs to the visual ledger.
export async function repairKrakenSupportedActions(source) {
    const sourceSha256=createHash('sha256').update(source).digest('hex');
    if(sourceSha256!=='30fc86b2a345810645eef604759e5b5c3796a6a98c43c951b791b55d74c7e8d3')throw Error('Unexpected Kraken face-repaired source');
    const {json,bin}=parseStudioGlb(source);
    if(json.animations.length!==13)throw Error('Expected all thirteen Kraken clips');
    let binary=bin;
    const configs=[],allowed=new Set(['head','neck','chest','spine','upper_armL','upper_armR','forearmL','forearmR','handL','handR']);
    for(const clip of json.animations) {
        const bones=clip.channels.filter(c=>c.target.path==='rotation'&&allowed.has(json.nodes[c.target.node].name?.replaceAll('.',''))).map(c=>json.nodes[c.target.node].name);
        if(!bones.length)continue;
        const config={clip:clip.name,bones,rotationExcursion:.25,reason:'Reduce incompatible upper-body joint excursions around the rigid central Kraken face, keeping visible original motion and exact root, pelvis, leg and tail curves. Candidate experiment; no visual approval inferred.'};
        binary=await applyReviewedAnimationClearance(json,binary,config);
        configs.push(config);
    }
    if(configs.length!==13||configs.reduce((sum,c)=>sum+c.bones.length,0)!==95)throw Error('Unexpected Kraken upper-body track coverage');
    const report={sourceSha256,configs};
    json.extras.krakenSupportedActionExperiment=report;
    return {bytes:compactGlbDelivery(encodeStudioGlb(json,binary)),report};
}
