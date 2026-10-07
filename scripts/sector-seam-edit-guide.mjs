import fs from 'node:fs/promises';
import path from 'node:path';
import { neighborConditionedGuide } from '../shinobij.client/scripts/gen-floor-from-layout.mjs';
import { artHash } from './sector-art-review-proof.mjs';

// Model reference only. The delivered floor must come from image_gen, never this composite.
const [sectorArg,revision,...destinationArgs]=process.argv.slice(2);
if(!sectorArg||!revision)throw Error('Usage: node --import tsx scripts/sector-seam-edit-guide.mjs sector revision [destination ...]');
const sector=Number(sectorArg),out=path.resolve('output/connected-world');
const task=JSON.parse(await fs.readFile(path.join(out,'tasks.json'),'utf8')).find(task=>task.id===sector);
if(!task)throw Error('Unknown sector');
const source=path.join(out,`s${task.artKey}-candidate.webp`);
const record=await neighborConditionedGuide(task,{basePainting:source,candidates:true,
    destinations:destinationArgs.length?destinationArgs.map(Number):undefined,
    out:path.join(out,`sector-${sector}-job-${revision}-seam-input`)});
if(!record.neighbors.length)throw Error('No actual neighbor references were selected');
const file=path.join(out,`sector-${sector}-job-${revision}-seam-guide.png`);
await fs.copyFile(record.guide,file);
const proof={sector,artKey:task.artKey,revision,file,layoutSha256:record.layoutSha256,
    sourceSha256:artHash(await fs.readFile(source)),sha256:artHash(await fs.readFile(file)),
    neighbors:record.neighbors,edgeReferenceVersion:record.edgeReferenceVersion,
    purpose:'model-input-only-not-delivered-art',editKind:'actual-neighbor-road-mouths'};
await fs.writeFile(file+'.json',JSON.stringify(proof,null,2)+'\n');
console.log(JSON.stringify(proof,null,2));
