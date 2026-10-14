import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const client = resolve(import.meta.dirname, '..'), lod = process.argv.includes('--lod');
const label = lod ? 'articulation-lod' : 'articulation-all';
const recheck = lod ? 'performance-lod-recheck' : 'performance-full-recheck';
const root = `.tmp/pet-performance-candidates/pet-models${lod ? '/warfront-lod' : ''}`;
const path = resolve(client, `.tmp/pet-animation-audit/all-pet-${label}-motion-audit.json`);
let report = JSON.parse(readFileSync(path));
if (report.summary.auditedModels !== 161 || report.failures.length) throw Error('Start with a structurally complete roster audit');
const run = (script, args) => {
    const result = spawnSync(process.execPath, ['--import', 'tsx', resolve(client, 'scripts', script), ...args], { cwd: client, encoding: 'utf8' });
    if (![0, 1].includes(result.status)) throw Error(result.stderr);
    if (result.stdout) process.stdout.write(result.stdout);
    return result.status;
};
for (let pass = 0; pass < 3 && report.deformationWarnings.length; pass++) {
    const ids = [...new Set(report.deformationWarnings.map(warning => warning.assetId))].join(',');
    run('repair-pet-performance-bindings.mjs', [`--root=${root}`, `--report=${path}`]);
    run('audit-all-pet-animation-poses.mjs', [`--model=${ids}`, `--asset-root=${root}`, `--label=${recheck}`, '--full-geometry']);
    const selected = JSON.parse(readFileSync(resolve(client, `.tmp/pet-animation-audit/${ids.includes(',') ? 'selected-pets' : ids}-${recheck}-motion-audit.json`)));
    if (selected.failures.length) throw Error(JSON.stringify(selected.failures));
    const updated = new Map(selected.pets.map(pet => [pet.id, pet]));
    report.pets = report.pets.map(pet => updated.get(pet.id) ?? pet);
    report.deformationWarnings = selected.deformationWarnings;
    report.summary.deformationWarnings = selected.deformationWarnings.length;
    report.summary.petsWithDeformationWarnings = new Set(selected.deformationWarnings.map(warning => warning.id)).size;
    report.summary.auditedPoses = report.pets.reduce((n, pet) => n + pet.clips.reduce((count, clip) => count + clip.samples.length, 0), 0);
    writeFileSync(path, JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ lod, pass: pass + 1, remainingWarnings: report.deformationWarnings.length }));
}
if (report.deformationWarnings.length) process.exitCode = 1;
