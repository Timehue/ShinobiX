import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { resolve, relative, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { runtimePetModels } from './lib/pet-runtime-audit.mjs';
import { parseStudioGlb } from './lib/pet-studio-glb.mjs';

const client = resolve(import.meta.dirname, '..'), sourceRoot = resolve(client, 'public/pet-models');
const candidateRoot = resolve(client, '.tmp/pet-performance-candidates/pet-models');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const audits = await Promise.all(['articulation-all', 'articulation-lod'].map(async label => JSON.parse(await readFile(resolve(client, `.tmp/pet-animation-audit/all-pet-${label}-motion-audit.json`)))));
for (const audit of audits) if (audit.summary.auditedModels !== 161 || audit.failures.length || audit.deformationWarnings.length
    || !audit.summary.geometryCoverage.startsWith('all vertices')) throw Error('Both full and LOD candidates must pass every complete-geometry pose');
const paths = [...new Set(runtimePetModels.flatMap(row => [row.path, resolve(sourceRoot, 'warfront-lod', relative(sourceRoot, row.path))]))];
const planned = [];
for (const path of paths) {
    const candidate = resolve(candidateRoot, relative(sourceRoot, path)), bytes = await readFile(candidate), { json, bin } = parseStudioGlb(bytes);
    const proof = json.extras?.performanceRefinement, original = await readFile(path), parsed = parseStudioGlb(original);
    if (proof?.revision !== '20261013-articulation-v1') throw Error('Candidate refinement missing: ' + path);
    if (hash(bin.subarray(0, proof.preservedPayloadBytes)) !== proof.preservedPayloadSha256 || hash(parsed.bin) !== proof.preservedPayloadSha256) throw Error('Reviewed source payload changed: ' + path);
    const audit = path.includes('warfront-lod') ? audits[1] : audits[0];
    if (!audit.pets.some(pet => pet.assetSha256 === hash(bytes))) throw Error('Candidate changed after pose certification: ' + path);
    planned.push({ path, bytes, before: hash(original), after: hash(bytes) });
}
for (const row of planned) {
    const backup = resolve(client, '.tmp/pet-performance-originals', relative(sourceRoot, row.path));
    await mkdir(dirname(backup), { recursive: true }); await copyFile(row.path, backup); await writeFile(row.path, row.bytes);
}
await writeFile(resolve(client, '.tmp/pet-performance-candidates/promotion-receipt.json'), JSON.stringify(planned.map(({ path, before, after, bytes }) => ({ path: relative(sourceRoot, path), before, after, bytes: bytes.length })), null, 2));
console.log(JSON.stringify({ promoted: planned.length, preservedGeometryAndAtlasPayload: true }));
