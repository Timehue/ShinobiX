import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import * as THREE from 'three';
import { runtimePetModels } from './lib/pet-runtime-audit.mjs';
import { loadPetDeformationProbe, preparePetHeadProbe, snapshotPetPose, petClipSampleTimes } from './lib/pet-deformation-probe.mjs';
import { oniSkullShare } from './repair-oni-hound-skull.mjs';

const root = resolve(import.meta.dirname, '..');
const filter = process.argv.find(a => a.startsWith('--model='))?.slice(8)?.split(',');
const assetRoot = process.argv.find(a => a.startsWith('--asset-root='))?.slice(13);
const asset = process.argv.find(a => a.startsWith('--asset='))?.slice(8);
const label = process.argv.find(a => a.startsWith('--label='))?.slice(8) ?? 'source';
if (asset && (!filter || filter.length !== 1)) throw Error('--asset requires one --model');
const rows = runtimePetModels.filter(row => !filter || filter.includes(row.pet.id));
if (!rows.length) throw Error('No production pets selected');
const pets = [], errors = [];
for (const row of rows) {
    try {
        const path = asset ? resolve(asset) : assetRoot ? resolve(assetRoot, relative(resolve(root, 'public/pet-models'), row.path)) : row.path;
        const gltf = await loadPetDeformationProbe(path);
        const anatomicalMask = row.model.visualId === 'mythic-4' ? point => oniSkullShare(point) === 1 : undefined;
        const probes = gltf.meshes.map(mesh => preparePetHeadProbe(mesh, anatomicalMask)).filter(Boolean);
        const restore = snapshotPetPose(gltf.scene), mixer = new THREE.AnimationMixer(gltf.scene);
        const clips = [];
        for (const clip of gltf.animations) {
            const samples = [];
            for (const time of petClipSampleTimes(clip)) {
                mixer.stopAllAction(); restore();
                const action = mixer.clipAction(clip).reset().setLoop(THREE.LoopOnce, 1);
                action.clampWhenFinished = true; action.play(); action.time = time; mixer.update(0); gltf.update();
                for (const [mesh, probe] of probes.entries()) if (probe.measure) {
                    const value = probe.measure();
                    // Independent of body size: compression matters as much as stretching.
                    if (value.changedEdges || value.maxDrift > .04) samples.push({ mesh, time, progress: time / clip.duration, ...value });
                }
            }
            clips.push({ name: clip.name, duration: clip.duration, sampledPoses: petClipSampleTimes(clip).length, findings: samples });
        }
        mixer.stopAllAction();
        const uncovered = !probes.length || probes.some(probe => probe.missing);
        pets.push({ id: row.pet.id, name: row.pet.name, assetId: row.model.visualId, runtimeUrl: row.model.url,
            sha256: gltf.sha256, uncovered, headRegions: probes.map(p => ({ vertices: p.vertices, edges: p.edges, missing: !!p.missing })),
            region: anatomicalMask ? 'reviewed-skull-mask' : 'head-dominant-weight-heuristic',
            status: uncovered ? 'needs-anatomical-mask' : clips.some(c => c.findings.length) ? 'needs-visual-review' : 'numeric-pass-needs-visual-review', clips });
        gltf.meshes.forEach(mesh => { mesh.geometry.dispose(); [].concat(mesh.material).forEach(m => m.dispose()); });
    } catch (error) { errors.push({ id: row.pet.id, error: error.message }); }
    if ((pets.length + errors.length) % 20 === 0) console.log(`Head shapes: ${pets.length + errors.length}/${rows.length}`);
}
const summary = { identities: rows.length, audited: pets.length, errors: errors.length,
    needsVisualReview: pets.filter(p => p.status === 'needs-visual-review').length,
    uncovered: pets.filter(p => p.uncovered).length,
    sampledPoses: pets.reduce((sum, p) => sum + p.clips.reduce((n, c) => n + c.sampledPoses, 0), 0),
    artisticCertification: false };
const out = resolve(root, '.tmp/pet-head-audit'); await mkdir(out, { recursive: true });
await writeFile(resolve(out, `${label}.json`), JSON.stringify({ schema: 1, summary, errors, pets }, null, 2) + '\n');
console.log(JSON.stringify(summary));
// Review findings fail the gate. No threshold tweak or hash baseline can approve art.
if (errors.length || summary.needsVisualReview || summary.uncovered) process.exitCode = 1;
