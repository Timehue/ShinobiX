import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { resolve, relative, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { runtimePetModels } from './lib/pet-runtime-audit.mjs';
import { parseStudioGlb } from './lib/pet-studio-glb.mjs';
import { CHARACTER_MOTION_REVISION } from './lib/pet-character-motion.mjs';
import { compactGlbDelivery } from './compact-glb-delivery.mjs';

const client = resolve(import.meta.dirname, '..'), root = resolve(client, 'public/pet-models');
const candidates = resolve(client, '.tmp/pet-character-candidates/pet-models'), originals = resolve(client, '.tmp/pet-character-originals');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const option = key => process.argv.find(arg => arg.startsWith(`--${key}=`))?.slice(key.length + 3);
async function evidence(key) {
    const files = option(key)?.split(','); if (!files?.length) throw Error('Missing complete-geometry audit reports: ' + key);
    const rows = new Map();
    for (const file of files) {
        const report = JSON.parse(await readFile(resolve(client, file)));
        if (report.failures.length || !report.summary.geometryCoverage.startsWith('all vertices')) throw Error('Invalid audit: ' + file);
        // A later audit supersedes a prior result only for the actual identities
        // it rechecked. Untouched meshes retain their original sealed evidence.
        for (const row of report.pets) rows.set(row.id, { ...row, warnings: report.deformationWarnings.filter(w => w.id === row.id), audit: file });
    }
    if (rows.size !== 161) throw Error('Audit coverage must include all 161 identities');
    for (const row of rows.values()) if (row.warnings.length) throw Error(`${row.id}: unresolved deformation warnings`);
    return rows;
}
const fullEvidence = await evidence('full-reports'), lodEvidence = await evidence('lod-reports');
const entries = [];
for (const row of new Map(runtimePetModels.map(row => [row.path, row])).values()) for (const lod of [false, true]) {
    const suffix = relative(root, row.path), path = lod ? resolve(root, 'warfront-lod', suffix) : row.path;
    const candidatePath = lod ? resolve(candidates, 'warfront-lod', suffix) : resolve(candidates, suffix);
    const bytes = await readFile(candidatePath), current = await readFile(path), { json, bin } = parseStudioGlb(bytes);
    const proof = json.extras.characterMotion;
    if (proof?.revision !== CHARACTER_MOTION_REVISION || hash(bin.subarray(0, proof.preservedPayloadBytes)) !== proof.preservedPayloadSha256) throw Error('Invalid source preservation proof: ' + path);
    if (hash(current) !== proof.sourceSha256 && hash(current) !== hash(bytes)) throw Error('Source changed after review: ' + path);
    const reviewed = (lod ? lodEvidence : fullEvidence).get(row.pet.id);
    if (reviewed.assetSha256 !== hash(bytes)) throw Error('Candidate changed after its final geometry audit: ' + candidatePath);
    entries.push({ path, bytes, current, beforeBytes: compactGlbDelivery(current).length, afterBytes: compactGlbDelivery(bytes).length,
        relative: relative(root, path), sha256: hash(bytes), audit: reviewed.audit });
}
// Validate the entire set before the first reversible production write.
for (const entry of entries) {
    if (entry.bytes.equals(entry.current)) continue;
    const backup = resolve(originals, entry.relative); await mkdir(dirname(backup), { recursive: true });
    let existing; try { existing = await readFile(backup); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (existing && !existing.equals(entry.current)) throw Error('Refusing to replace a different original backup');
    if (!existing) await writeFile(backup, entry.current);
    await writeFile(entry.path + '.character-tmp', entry.bytes); await rename(entry.path + '.character-tmp', entry.path);
}
const atomicJson = async (path, value) => { await writeFile(path + '.character-tmp', JSON.stringify(value, null, 2) + '\n'); await rename(path + '.character-tmp', path); };
const lodPath = resolve(root, 'warfront-lod/manifest.json'), lod = JSON.parse(await readFile(lodPath));
for (const row of lod.entries) {
    const source = await readFile(resolve(client, 'public', row.sourceUrl.slice(1))), model = await readFile(resolve(client, 'public', row.lodUrl.split('?')[0].slice(1)));
    row.sourceBytes = source.length; row.sourceSha256 = hash(source); row.lodBytes = model.length; row.lodSha256 = hash(model);
    row.lodUrl = `${row.lodUrl.split('?')[0]}?v=${lod.revision}-${row.sourceSha256.slice(0, 12)}-${row.lodSha256.slice(0, 12)}`;
}
await atomicJson(lodPath, lod);
const rosterPath = resolve(root, 'roster-manifest.json'), roster = JSON.parse(await readFile(rosterPath));
for (const [id, row] of Object.entries(roster.entries)) {
    const bytes = await readFile(resolve(root, 'roster', id + '.glb'));
    row.sha256 = hash(bytes).toUpperCase(); if (row.validation) row.validation.bytes = bytes.length;
}
await atomicJson(rosterPath, roster);
const output = resolve(client, '.tmp/pet-character-review/promotion-receipt.json'); await mkdir(dirname(output), { recursive: true });
await atomicJson(output, { revision: CHARACTER_MOTION_REVISION, identities: 161, assets: entries.length,
    reviewedPoses: [...fullEvidence.values(), ...lodEvidence.values()].reduce((sum, row) => sum + row.clips.reduce((sum, clip) => sum + clip.samples.length, 0), 0),
    deformationWarnings: 0, deliveredDeltaBytes: entries.reduce((sum, row) => sum + row.afterBytes - row.beforeBytes, 0),
    entries: entries.map(({ relative, sha256, beforeBytes, afterBytes, audit }) => ({ path: relative.replaceAll('\\', '/'), sha256, beforeBytes, afterBytes, audit })) });
console.log(JSON.stringify({ assets: entries.length, deliveredDeltaBytes: entries.reduce((sum, row) => sum + row.afterBytes - row.beforeBytes, 0), warnings: 0 }));
