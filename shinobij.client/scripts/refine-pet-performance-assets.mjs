import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { resolve, dirname, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { Euler, Quaternion } from 'three';
import { runtimePetModels } from './lib/pet-runtime-audit.mjs';
import { studioTangents } from './lib/pet-studio-curves.mjs';
import { studioJointDeltas, sampleStudioRotation, delayedStudioRotation } from './lib/pet-studio-articulation.mjs';
import { align4, parseStudioGlb, encodeStudioGlb, readStudioAccessor } from './lib/pet-studio-glb.mjs';

const client = resolve(import.meta.dirname, '..'), publicRoot = resolve(client, 'public');
const candidateRoot = resolve(client, '.tmp/pet-performance-candidates');
const apply = process.argv.includes('--apply');
const lodOnly = process.argv.includes('--lod');
const ids = process.argv.find(a => a.startsWith('--model='))?.slice(8).split(',');
const revision = '20261013-articulation-v1';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const clips = new Set(['attack', 'cast', 'guard', 'idle_hitreact1', 'gallop_jump', 'entrance', 'victory']);
let paths;
if (apply && !ids) {
    const scan = async dir => {
        const paths = [];
        for (const file of await readdir(dir, { withFileTypes: true })) {
            if (file.isDirectory() && file.name !== 'warfront-impostors') paths.push(...await scan(resolve(dir, file.name)));
            else if (file.name.endsWith('.glb')) paths.push(resolve(dir, file.name));
        }
        return paths;
    };
    paths = await scan(resolve(publicRoot, 'pet-models'));
} else paths = runtimePetModels.filter(row => !ids || ids.includes(row.pet.id)).map(row => lodOnly
    ? resolve(publicRoot, 'pet-models/warfront-lod', relative(resolve(publicRoot, 'pet-models'), row.path)) : row.path);
paths = [...new Set(paths)];
if (!paths.length) throw Error('No models matched');
const receipts = [];
for (const path of paths) {
    const original = await readFile(path), { json, bin } = parseStudioGlb(original);
    const output = apply ? path : resolve(candidateRoot, relative(publicRoot, path));
    if (!apply && process.argv.includes('--keep-reviewed')) {
        let candidate;
        try { candidate = parseStudioGlb(await readFile(output)); } catch { /* No reviewed candidate yet. */ }
        const proof = candidate?.json.extras?.performanceRefinement;
        if (proof?.revision === revision && proof.preservedPayloadSha256 === hash(bin)
            && candidate.json.animations.every((take, i) => candidate.json.accessors[take.samplers.at(-1).input].count === json.accessors[json.animations[i].samplers[0].input].count)) {
            receipts.push({ path: relative(publicRoot, path), tracks: proof.addedTracks, reviewedCandidateKept: true }); continue;
        }
    }
    const prior = json.extras?.performanceRefinement;
    if (prior?.revision === revision) {
        if (hash(bin.subarray(0, prior.preservedPayloadBytes)) !== prior.preservedPayloadSha256) throw Error('Source payload changed: ' + path);
        receipts.push({ path: relative(publicRoot, path), tracks: prior.addedTracks, skipped: true }); continue;
    }
    const names = new Set(json.nodes.map(node => node.name)), byName = new Map(json.nodes.map((node, i) => [node.name, i]));
    const sourceBoundary = { accessors: json.accessors.length, bufferViews: json.bufferViews.length, binary: bin.length,
        channels: json.animations.map(clip => clip.channels.length), samplers: json.animations.map(clip => clip.samplers.length) };
    const chunks = [bin]; let byteLength = bin.length, addedTracks = 0;
    const add = (values, type, min, max) => {
        const pad = align4(byteLength) - byteLength; if (pad) chunks.push(Buffer.alloc(pad)); byteLength += pad;
        const bytes = Buffer.from(values.buffer, values.byteOffset, values.byteLength); chunks.push(bytes);
        json.bufferViews.push({ buffer: 0, byteOffset: byteLength, byteLength: bytes.length }); byteLength += bytes.length;
        json.accessors.push({ bufferView: json.bufferViews.length - 1, componentType: 5126, count: values.length / (type === 'VEC4' ? 4 : 1), type,
            ...(min ? { min } : {}), ...(max ? { max } : {}) });
        return json.accessors.length - 1;
    };
    for (const clip of json.animations) {
        if (!clips.has(clip.name)) continue;
        const existing = new Map(clip.channels.filter(c => c.target.path === 'rotation').map(c => [json.nodes[c.target.node].name, c]));
        const takeTimes = (await readStudioAccessor(json, bin, clip.samplers[0].input)).values;
        const duration = takeTimes[takeTimes.length - 1], times = takeTimes;
        // Match the reviewed contact keys exactly. Secondary articulation adds
        // no separate pose clock or competing timing to the original take.
        const steps = Array.from(times, time => time / duration);
        let input;
        const append = (name, quaternions) => {
            if (existing.has(name) || !byName.has(name)) return;
            for (let i = 1; i < steps.length; i++) if (quaternions[i - 1].dot(quaternions[i]) < 0) quaternions[i].set(-quaternions[i].x, -quaternions[i].y, -quaternions[i].z, -quaternions[i].w);
            const values = Float32Array.from(quaternions.flatMap(q => q.toArray())), tangents = studioTangents(times, values, 4);
            const output = new Float32Array(steps.length * 12);
            for (let i = 0; i < steps.length; i++) for (let a = 0; a < 4; a++) {
                output[i * 12 + a] = tangents[i * 4 + a]; output[i * 12 + 4 + a] = values[i * 4 + a]; output[i * 12 + 8 + a] = tangents[i * 4 + a];
            }
            input ??= add(times, 'SCALAR', [0], [duration]);
            clip.samplers.push({ input, output: add(output, 'VEC4'), interpolation: 'CUBICSPLINE' });
            clip.channels.push({ sampler: clip.samplers.length - 1, target: { node: byName.get(name), path: 'rotation' } }); addedTracks++;
        };
        const deltas = steps.map(p => studioJointDeltas(names, clip.name, p));
        for (const name of deltas[0].keys()) {
            const bind = new Quaternion().fromArray(json.nodes[byName.get(name)].rotation ?? [0, 0, 0, 1]).normalize();
            append(name, deltas.map(map => bind.clone().multiply(new Quaternion().setFromEuler(new Euler(...map.get(name), 'XYZ'))).normalize()));
        }
        for (const [sourceName, targetName, lag, gain] of [
            ['tail_1', 'tail_2', .06, .60], ['tail_1', 'tail_3', .12, .35],
            ['scarf_1', 'scarf_2', .07, .40], ['head', 'neck', .025, .12],
        ]) {
            const channel = existing.get(sourceName);
            if (!channel || !byName.has(targetName) || existing.has(targetName) || clip.name === 'guard') continue;
            const sampler = clip.samplers[channel.sampler];
            const sourceTimes = (await readStudioAccessor(json, bin, sampler.input)).values;
            const sourceValues = (await readStudioAccessor(json, bin, sampler.output)).values;
            const sourceBind = new Quaternion().fromArray(json.nodes[byName.get(sourceName)].rotation ?? [0, 0, 0, 1]).normalize();
            const targetBind = new Quaternion().fromArray(json.nodes[byName.get(targetName)].rotation ?? [0, 0, 0, 1]).normalize();
            append(targetName, steps.map(p => delayedStudioRotation(sourceBind, targetBind,
                at => sampleStudioRotation(sourceTimes, sourceValues, sampler.interpolation, at), p, lag, gain)));
        }
    }
    json.extras.performanceRefinement = { revision, addedTracks, sourceBoundary, preservedPayloadBytes: bin.length, preservedPayloadSha256: hash(bin) };
    json.buffers[0].byteLength = align4(byteLength);
    const binary = Buffer.concat([...chunks, Buffer.alloc(align4(byteLength) - byteLength)]);
    if (!binary.subarray(0, bin.length).equals(bin)) throw Error('Reviewed geometry or original motion changed');
    const out = encodeStudioGlb(json, binary);
    await mkdir(dirname(output), { recursive: true }); await writeFile(output, out);
    receipts.push({ path: relative(publicRoot, path).replaceAll('\\', '/'), tracks: addedTracks, originalBytes: original.length, bytes: out.length });
}
await mkdir(candidateRoot, { recursive: true });
await writeFile(resolve(candidateRoot, apply ? 'production-receipt.json' : 'candidate-receipt.json'), JSON.stringify(receipts, null, 2));
console.log(JSON.stringify({ candidate: !apply, models: receipts.length, tracks: receipts.reduce((n, r) => n + r.tracks, 0), reviewedPayloadPreserved: true }));
