import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { validateRenderedReview } from './sector-art-review-proof.mjs';

const [sectorArg,revision,promptFile]=process.argv.slice(2);
if(!sectorArg||!revision||!promptFile)throw Error('Usage: node scripts/record-sector-art-job.mjs sector revision prompt.txt');
const sector=Number(sectorArg),out=path.resolve('output/connected-world');
const guideOnly=process.argv.includes('--guide-only');
const annotated=process.argv.includes('--annotated');
const paintGuideArg=process.argv.find(arg=>arg.startsWith('--paint-guide='));
const styleAnchor=process.argv.find(arg=>arg.startsWith('--style-anchor='))?.slice('--style-anchor='.length);
const records=JSON.parse(await fs.readFile(path.join(out,'conditioned/tasks.json'),'utf8'));
const record=records.find(item=>item.sector===sector);
if(!record?.layoutSha256)throw Error(`No current conditioned guide for sector ${sector}`);
const currentLayouts=JSON.parse(await fs.readFile(path.join(out,'layouts.json'),'utf8'));
if(record.layoutSha256!==createHash('sha256').update(JSON.stringify(currentLayouts[record.artKey])).digest('hex'))throw Error('Guide layout is stale; rebuild the neighbor-conditioned guide');
const stem=path.join(out,`sector-${sector}-job-${revision}`);
const inputs=[];
const style=path.join(out,`s${record.artKey}-candidate.webp`);
const paintGuide=paintGuideArg?.slice('--paint-guide='.length);
if(!paintGuide) {
    if(record.edgeReferenceVersion!==2)throw Error('Neighbor guide predates the verified reverse-edge crop; rebuild it');
    if(record.guideSha256!==createHash('sha256').update(await fs.readFile(record.guide)).digest('hex'))throw Error('Conditioned guide was modified after recording');
    for(const neighbor of record.neighbors)if(neighbor.sha256!==createHash('sha256').update(await fs.readFile(neighbor.file)).digest('hex'))throw Error('Neighbor reference is stale; rebuild the neighbor-conditioned guide');
}
let paintGuideProof, parentArtwork;
if(paintGuide) {
    const proof=JSON.parse(await fs.readFile(paintGuide+'.json','utf8'));
    if(proof.sector!==sector||proof.layoutSha256!==record.layoutSha256
        ||proof.sourceSha256!==createHash('sha256').update(await fs.readFile(style)).digest('hex')
        ||proof.sha256!==createHash('sha256').update(await fs.readFile(paintGuide)).digest('hex'))throw Error('Paint-guide reference is not current');
    paintGuideProof=proof;
    if(proof.neighbors?.length) {
        if(proof.edgeReferenceVersion!==2)throw Error('Seam guide predates the verified reverse-edge crop; rebuild it');
        for(const neighbor of proof.neighbors)if(neighbor.sha256!==createHash('sha256').update(await fs.readFile(neighbor.file)).digest('hex'))throw Error('Paint-guide neighbor reference is stale; rebuild it');
    }
    parentArtwork=JSON.parse(await fs.readFile(path.join(out,`s${record.artKey}-provenance.json`),'utf8'));
    if(parentArtwork.sha256!==proof.sourceSha256)throw Error('Paint-guide parent artwork provenance is not current');
}
if(annotated) {
    const report=JSON.parse(await fs.readFile(path.join(out,'candidate-alignment/report.json'),'utf8'));
    const reviewed=report.results.find(item=>item.sector===sector);
    if(reviewed?.sha256!==createHash('sha256').update(await fs.readFile(style)).digest('hex')
        ||reviewed.layoutSha256!==record.layoutSha256)throw Error('Hatched review image is not current');
    await validateRenderedReview({file:path.join(out,`candidate-alignment/sector-${sector}-mask.png`),
        paintingSha256:reviewed.sha256,layoutSha256:reviewed.layoutSha256});
}
const references=paintGuide?[
    ['model-input-paint-region-guide',paintGuide,'guide.png'],
    ...(styleAnchor?[['material-and-brushwork-reference',styleAnchor,'anchor.png']]:[]),
]:annotated?[
    ['edit-target-floor',style,'style.webp'],
    ['annotated-current-occupancy-review',path.join(out,`candidate-alignment/sector-${sector}-mask.png`),'mask.png'],
    ['geometry-and-real-neighbor-reference',record.guide,'guide.png'],
]:[
    ['geometry-and-real-neighbor-reference',record.guide,'guide.png'],
    ...(!guideOnly?[['existing-painting-style-reference',style,'style.webp']]:[])];
for(const [role,source,suffix] of references) {
    const file=stem+'-'+suffix;
    await fs.copyFile(source,file);
    inputs.push({role,file,sha256:createHash('sha256').update(await fs.readFile(file)).digest('hex')});
}
const manifest={sector,artKey:record.artKey,revision,tool:'built-in-image-gen',layoutSha256:record.layoutSha256,
    promptFile:path.resolve(promptFile),promptSha256:createHash('sha256').update(await fs.readFile(promptFile)).digest('hex'),inputs,
    neighbors:paintGuideProof?(paintGuideProof.neighbors??[]):record.neighbors,
    edgeReferenceVersion:paintGuideProof?.edgeReferenceVersion??(!paintGuide?record.edgeReferenceVersion:undefined),
    paintGuideProof,parentArtwork};
await fs.writeFile(stem+'-inputs.json',JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify(manifest,null,2));
