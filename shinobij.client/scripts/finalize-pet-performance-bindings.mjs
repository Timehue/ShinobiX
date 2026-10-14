import { readFile, writeFile } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { spawnSync } from 'node:child_process';
import { runtimePetModels } from './lib/pet-runtime-audit.mjs';
import { parseStudioGlb, encodeStudioGlb } from './lib/pet-studio-glb.mjs';

const client = resolve(import.meta.dirname, '..'), modelRoot = resolve(client, 'public/pet-models');
const candidateRoot = resolve(client, '.tmp/pet-performance-candidates/pet-models');
const reportPath = resolve(client, '.tmp/pet-animation-audit/all-pet-articulation-all-motion-audit.json');
let report = JSON.parse(await readFile(reportPath));
const ids = [...new Set(report.deformationWarnings.map(warning => warning.assetId))].join(',');
if (!ids) { console.log('All candidate poses already pass.'); process.exit(0); }
const run = (script, args) => {
    const result = spawnSync(process.execPath, ['--import', 'tsx', resolve(client, 'scripts', script), ...args], { cwd: client, encoding: 'utf8' });
    if (![0, 1].includes(result.status)) throw Error(result.stderr);
    if (result.stdout) process.stdout.write(result.stdout);
    return result.status;
};
// Reset only unsupported rigs to their reviewed binding; keep the verified
// candidates and their complete-geometry certificates for every other pet.
run('refine-pet-performance-assets.mjs', [`--model=${ids}`]);
const selectedLabel = 'performance-final';
const selectedPath = resolve(client, `.tmp/pet-animation-audit/${ids.includes(',') ? 'selected-pets' : ids}-${selectedLabel}-motion-audit.json`);
const audit = () => run('audit-all-pet-animation-poses.mjs', [`--model=${ids}`, `--asset-root=${candidateRoot}`, `--label=${selectedLabel}`, '--full-geometry']);
audit();
let selected = JSON.parse(await readFile(selectedPath));
if (selected.failures.length) throw Error(JSON.stringify(selected.failures));
for (const id of new Set(selected.deformationWarnings.map(warning => warning.assetId))) {
    const model = runtimePetModels.find(row => row.model.visualId === id);
    const path = resolve(candidateRoot, relative(modelRoot, model.path)), { json, bin } = parseStudioGlb(await readFile(path));
    const unsupported = new Set(selected.deformationWarnings.filter(warning => warning.assetId === id).map(warning => warning.clip));
    const proof = json.extras.performanceRefinement;
    proof.originalPoseFallbacks = [...unsupported];
    json.animations.forEach((clip, index) => {
        if (!unsupported.has(clip.name)) return;
        proof.addedTracks -= clip.channels.length - proof.sourceBoundary.channels[index];
        clip.channels = clip.channels.slice(0, proof.sourceBoundary.channels[index]);
        clip.samplers = clip.samplers.slice(0, proof.sourceBoundary.samplers[index]);
    });
    await writeFile(path, encodeStudioGlb(json, bin));
}
if (audit() !== 0) throw Error('Original-pose fallbacks did not pass their full geometry check');
selected = JSON.parse(await readFile(selectedPath));
const updated = new Map(selected.pets.map(pet => [pet.id, pet]));
report.pets = report.pets.map(pet => updated.get(pet.id) ?? pet);
report.deformationWarnings = [];
report.summary.deformationWarnings = report.summary.petsWithDeformationWarnings = 0;
report.summary.auditedPoses = report.pets.reduce((sum, pet) => sum + pet.clips.reduce((n, clip) => n + clip.samples.length, 0), 0);
await writeFile(reportPath, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ verifiedModels: report.pets.length, deformationWarnings: 0, originalPosesPreservedWhereRequired: true }));
