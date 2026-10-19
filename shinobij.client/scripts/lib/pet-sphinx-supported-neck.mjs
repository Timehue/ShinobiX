import {createHash} from 'node:crypto';
import {parseStudioGlb,encodeStudioGlb} from './pet-studio-glb.mjs';
import {applyReviewedAnimationClearance} from './pet-animation-clearance.mjs';
import {compactGlbDelivery} from '../compact-glb-delivery.mjs';

// The hanging mane must stay flexible while the lower jaw stays rigid. Retain
// every authored body and limb curve and reduce only incompatible head/neck
// excursions. Candidate provenance is retained for exact replay; visual
// approval is recorded separately in the review ledger.
export async function repairSphinxSupportedNeck(source) {
    const sourceSha256=createHash('sha256').update(source).digest('hex');
    if(sourceSha256!=='78a7d3d8f71ca5187ad7eca3797070af1d505d249ad991ddfe78ae3ba2d98c6b')throw Error('Unexpected Sphinx face-repaired source');
    const {json,bin}=parseStudioGlb(source),configs=[];
    if(json.animations.length!==13)throw Error('Expected all thirteen Sphinx clips');
    let binary=bin;
    for(const clip of json.animations){
        const bones=clip.channels.filter(c=>c.target.path==='rotation'&&['head','neck'].includes(json.nodes[c.target.node].name)).map(c=>json.nodes[c.target.node].name);
        if(!bones.length)continue;
        const config={clip:clip.name,bones,rotationExcursion:.25,reason:'Keep the rigid lower jaw coordinated with its connected flexible mane by reducing incompatible head and neck excursions. All body, root, pelvis, four leg, wing and tail tracks remain authored. Candidate only; no visual approval inferred.'};
        binary=await applyReviewedAnimationClearance(json,binary,config);configs.push(config);
    }
    if(configs.length!==9||configs.reduce((n,c)=>n+c.bones.length,0)!==18)throw Error('Unexpected Sphinx neck track coverage');
    const report={sourceSha256,configs};json.extras.sphinxSupportedNeckCandidate=report;
    return {bytes:compactGlbDelivery(encodeStudioGlb(json,binary)),report};
}
