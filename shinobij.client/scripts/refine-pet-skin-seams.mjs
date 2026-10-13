import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { resolve, relative, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { repairAsset } from './repair-pet-skin-seams.mjs';
import { runtimePetModels } from './lib/pet-runtime-audit.mjs';
import { PET_SKIN_REPAIR_REVISIONS } from '../src/generated/pet-skin-repair-revisions.ts';
const lod = process.argv.includes('--lod');
const option = name => process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const client = resolve(import.meta.dirname, '..');
const reportOption = option('report'), fullGeometry = process.argv.includes('--full-geometry');
const maxPasses = Number(option('max-passes') ?? 24);
if (!Number.isInteger(maxPasses) || maxPasses < 1 || maxPasses > 64) throw Error('--max-passes must be an integer from 1 to 64.');
const candidates = resolve(client, option('candidate-root') ?? (lod ? '.tmp/lod-skin-candidates' : '.tmp/pet-skin-candidates'));
if (!relative(resolve(client, '.tmp'), candidates) || relative(resolve(client, '.tmp'), candidates).startsWith('..')) throw Error('Candidates must live in a task-specific .tmp subdirectory.');
const label = option('label') ?? (lod ? 'lod-local' : 'local');
let report = JSON.parse(await readFile(resolve(client, reportOption ?? `.tmp/pet-animation-audit/selected-pets-${label}-motion-audit.json`)));
if (report.failures.length) throw Error('Repair structural failures before refining skin seams.');
if (fullGeometry && !report.summary.geometryCoverage?.startsWith('all vertices')) throw Error('A complete-geometry repair requires a complete-geometry input audit.');
const selectedIds = new Set(report.deformationWarnings.map(w => w.assetId));
const rows = [...new Map(runtimePetModels.filter(row => selectedIds.has(row.model.visualId)).map(row => [row.path, row])).values()];
const selected = rows.map(row => row.model.visualId).join(',');
const reportPath = resolve(client, `.tmp/pet-animation-audit/${selected.includes(',') ? 'selected-pets' : selected}-${label}-motion-audit.json`);
const logPath = resolve(candidates, 'localized-refinement-report.json');
const resume = process.argv.includes('--resume');
if (resume && rows.length) report = JSON.parse(await readFile(reportPath));
const certifiedPets = new Map(report.pets.filter(pet => selectedIds.has(pet.assetId)).map(pet => [pet.id, pet]));
const sourceRoot = resolve(client, 'public/pet-models');
const originalHashes = new Map(), hash = bytes => createHash('sha256').update(bytes).digest('hex');
const inputHashesPath = resolve(candidates, 'input-hashes.json');
const expectedInputs = resume && rows.length ? JSON.parse(await readFile(inputHashesPath)) : null;
if (lod || reportOption) for (const row of rows) {
    const path = relative(sourceRoot, row.path), source = lod ? resolve(sourceRoot, 'warfront-lod', path) : row.path;
    await mkdir(dirname(resolve(candidates, path)), { recursive: true });
    const inputHash = hash(await readFile(source));
    if (expectedInputs && expectedInputs[row.model.visualId] !== inputHash) throw Error(`${path}: source changed since candidate creation; cannot resume.`);
    originalHashes.set(row.model.visualId, inputHash);
    if (resume) { if (!existsSync(resolve(candidates, path))) throw Error(`${path}: candidate missing for --resume.`); }
    else await copyFile(source, resolve(candidates, path));
}
if (!resume && originalHashes.size) await writeFile(inputHashesPath, JSON.stringify(Object.fromEntries(originalHashes), null, 2));
const log = resume && existsSync(logPath) ? JSON.parse(await readFile(logPath)) : [];
let needsFullSelectedAudit = fullGeometry && rows.length > 0;
for (let pass = log.length; pass < maxPasses && (report.deformationWarnings.length || needsFullSelectedAudit); pass++) {
    const damagedIds = [...new Set(report.deformationWarnings.map(w => w.assetId))];
    for (const id of damagedIds) {
        const row = rows.find(row => row.model.visualId === id);
        const path = resolve(candidates, relative(resolve(client, 'public/pet-models'), row.path));
        const output = resolve(candidates, 'localized', relative(candidates, path));
        const warnings = report.deformationWarnings.filter(w => w.assetId === id);
        const pairs = warnings.flatMap(w => w.worstEdges?.map(e => e.vertices) ?? []);
        if (!pairs.length) throw Error(`${id}: repeat the input audit with --details before repair.`);
        const diffuse = process.argv.includes('--diffuse') && warnings.some(w => w.worstEdges?.some(e => e.kind !== 'uv-seam'));
        await repairAsset(path, output, diffuse ? 256 : 0, pairs); await copyFile(output, path);
    }
    const checkedIds = damagedIds.length ? damagedIds.join(',') : selected;
    if (!damagedIds.length) needsFullSelectedAudit = false;
    const result = spawnSync(process.execPath, [resolve(client, '../node_modules/tsx/dist/cli.mjs'), resolve(client, 'scripts/audit-all-pet-animation-poses.mjs'), `--model=${checkedIds}`, `--asset-root=${candidates}`, `--label=${label}`, '--details', ...(fullGeometry ? ['--full-geometry'] : [])], { cwd: client, encoding: 'utf8' });
    if (![0, 1].includes(result.status)) throw Error(result.stderr);
    report = JSON.parse(await readFile(resolve(client, `.tmp/pet-animation-audit/${checkedIds.includes(',') ? 'selected-pets' : checkedIds}-${label}-motion-audit.json`)));
    if (report.failures.length) throw Error(JSON.stringify(report.failures));
    for (const pet of report.pets) certifiedPets.set(pet.id, pet);
    report.pets = [...certifiedPets.values()];
    // An unchanged certified candidate retains its complete-geometry evidence;
    // only the models touched in this pass need another full pose evaluation.
    report.summary.attemptedModels = report.summary.auditedModels = report.pets.length;
    report.summary.distinctRuntimeAssets = new Set(report.pets.map(pet => pet.assetId)).size;
    report.summary.auditedPoses = report.pets.reduce((sum, pet) => sum + pet.clips.reduce((total, clip) => total + clip.samples.length, 0), 0);
    report.summary.showcaseAuthored = report.pets.filter(pet => pet.source === 'showcase').length;
    report.summary.identityAuthored = report.pets.length - report.summary.showcaseAuthored;
    report.summary.identityDirected = report.pets.length;
    report.summary.uniquePerformanceFingerprints = report.summary.distinctRuntimeAssets;
    report.summary.rigs = [...new Set(report.pets.map(pet => pet.rig))].sort();
    report.summary.families = [...new Set(report.pets.map(pet => pet.family))].sort();
    await writeFile(reportPath, JSON.stringify(report, null, 2));
    log.push({ pass: pass + 1, warnings: report.deformationWarnings.length, pets: report.summary.petsWithDeformationWarnings });
    await writeFile(logPath, JSON.stringify(log, null, 2));
    console.log(JSON.stringify(log.at(-1)));
}
await mkdir(candidates, { recursive: true });
await writeFile(resolve(candidates, 'localized-refinement-report.json'), JSON.stringify(log, null, 2));
if (report.deformationWarnings.length || needsFullSelectedAudit) process.exitCode = 1;
else if (process.argv.includes('--promote') || lod && !reportOption) {
    // Verify every source before changing any file. Preserve an independent
    // backup and receipt for this refinement, including repeated invocations.
    for (const row of rows) {
        const path = relative(sourceRoot, row.path), source = lod ? resolve(sourceRoot, 'warfront-lod', path) : row.path;
        if (hash(await readFile(source)) !== originalHashes.get(row.model.visualId)) throw Error(`${path}: source changed during candidate validation.`);
    }
    const revisions = { ...PET_SKIN_REPAIR_REVISIONS }, receipts = [];
    const manifestPath = resolve(sourceRoot, 'roster-manifest.json'), manifest = JSON.parse(await readFile(manifestPath));
    for (const row of rows) {
        const path = relative(sourceRoot, row.path), source = lod ? resolve(sourceRoot, 'warfront-lod', path) : row.path;
        const backup = resolve(client, '.tmp/pet-double-check-originals', lod ? 'lod' : 'source', path);
        await mkdir(dirname(backup), { recursive: true });
        if (!existsSync(backup)) await copyFile(source, backup);
        const bytes = await readFile(resolve(candidates, path)), sha256 = hash(bytes);
        await copyFile(resolve(candidates, path), source);
        receipts.push({ id: row.model.visualId, path, beforeSha256: originalHashes.get(row.model.visualId), sha256, bytes: bytes.length });
        if (!lod) {
            revisions[row.model.visualId] = '20261012-connected-weight-v2';
            const entry = manifest.entries[row.model.visualId];
            if (path.replaceAll('\\', '/').startsWith('roster/') && entry) {
                entry.sha256 = sha256.toUpperCase();
                if (entry.validation) entry.validation.bytes = bytes.length;
                entry.skinSeamRepair = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12))).extras.skinSeamRepair;
            }
        }
    }
    if (!lod) {
        await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
        await writeFile(resolve(client, 'src/generated/pet-skin-repair-revisions.ts'), `/* Generated by pet skin repair promotion tools. */\nexport const PET_SKIN_REPAIR_REVISIONS: Readonly<Record<string, string>> = ${JSON.stringify(revisions, null, 4)};\n`);
    }
    await writeFile(resolve(candidates, 'promotion-receipt.json'), JSON.stringify(receipts, null, 2));
    console.log(JSON.stringify({ promoted: rows.length, fullGeometry }));
}
