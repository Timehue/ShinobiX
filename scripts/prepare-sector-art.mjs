import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { validateArtworkInputs } from './sector-art-review-proof.mjs';

const [sectorArg, source, promptFile, referenceManifest] = process.argv.slice(2);
if (!sectorArg || !source || !promptFile) throw new Error('Usage: node scripts/prepare-sector-art.mjs sector source.png prompt.txt [frozen-inputs.json]');
const tasks = JSON.parse(await fs.readFile('output/connected-world/tasks.json', 'utf8'));
const task = tasks.find(t => t.id === Number(sectorArg));
if (!task) throw new Error('Unknown sector');
const output = path.resolve('output/connected-world/s' + task.artKey + '-candidate.webp');
const layouts = JSON.parse(await fs.readFile('output/connected-world/layouts.json', 'utf8'));
const layoutSha256 = createHash('sha256').update(JSON.stringify(layouts[task.artKey])).digest('hex');
const references=referenceManifest?JSON.parse(await fs.readFile(referenceManifest,'utf8')):undefined;
const prompt = await fs.readFile(promptFile, 'utf8');
if(references)await validateArtworkInputs({manifest:references,sector:task.id,layoutSha256,prompt});
const sourceMeta=await sharp(source).metadata();
if(sourceMeta.width!==sourceMeta.height)throw Error('A tactical floor must retain its square source geometry');
// Packaging only: retain the complete frame, normalize size, strip metadata.
const floorBudgetBytes = 250 * 1024;
let quality = 84, bytes;
// Preserve full-frame 1024 geometry; reduce encoding quality only to meet the delivery budget.
do {
    bytes = await sharp(source).resize(1024, 1024, { fit: 'fill' }).webp({ quality, effort: 6 }).toBuffer();
    if (bytes.length <= floorBudgetBytes) break;
    quality -= 4;
} while (quality >= 28);
if (bytes.length > floorBudgetBytes) throw new Error('Floor exceeds the handoff\'s 250 KiB delivery budget: ' + bytes.length);
await fs.writeFile(output, bytes);
const hash = createHash('sha256').update(bytes).digest('hex');
const provenance={
    sector: task.id, artKey: task.artKey, name: task.name, source, output, sha256: hash,
    width: 1024, height: 1024, bytes: bytes.length, quality, prompt, layoutSha256, budgetBytes: floorBudgetBytes, references,
    sourceSha256:createHash('sha256').update(await fs.readFile(source)).digest('hex'),
    status: 'candidate-awaiting-visual-review',
};
await fs.writeFile('output/connected-world/s' + task.artKey + '-provenance.json', JSON.stringify(provenance, null, 2));
if(references?.revision)await fs.writeFile(`output/connected-world/sector-${task.id}-job-${references.revision}-output.json`,JSON.stringify(provenance,null,2)+'\n');
console.log(JSON.stringify({ sector: task.id, artKey: task.artKey, output, bytes: bytes.length, sha256: hash }));
