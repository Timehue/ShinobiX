import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, relative, dirname } from 'node:path';
import { MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';
import { runtimePetModels } from './lib/pet-runtime-audit.mjs';
import { petCombatFamily } from '../src/lib/pet-combat-family.ts';
import { align4, parseStudioGlb, encodeStudioGlb, readStudioAccessor } from './lib/pet-studio-glb.mjs';
import { studioTangents } from './lib/pet-studio-curves.mjs';
import { CHARACTER_MOTION_REVISION, createCharacterRig, readCharacterTake, finishCharacterTake } from './lib/pet-character-motion.mjs';

// Offline authoring only: shipping models contain normal animation samplers.
// Geometry, atlas bytes, and all previous review receipts remain untouched.
await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready]);
const client = resolve(import.meta.dirname, '..'), publicRoot = resolve(client, 'public');
const candidateRoot = resolve(client, '.tmp/pet-character-candidates');
const ids = process.argv.find(arg => arg.startsWith('--model='))?.slice(8).split(',');
const lod = process.argv.includes('--lod');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const rows = [...new Map(runtimePetModels.filter(row => !ids || ids.includes(row.pet.id)).map(row => [row.path, row])).values()];
const receipts = [];
for (const row of rows) {
    const path = lod ? resolve(publicRoot, 'pet-models/warfront-lod', relative(resolve(publicRoot, 'pet-models'), row.path)) : row.path;
    const original = await readFile(path), { json, bin } = parseStudioGlb(original);
    const sourceAccessors = json.accessors.length;
    if (json.extras?.characterMotion?.revision === CHARACTER_MOTION_REVISION) throw Error('Refusing to author over promoted motion: ' + path);
    const rig = createCharacterRig(json), family = petCombatFamily(row.pet), streams = [], clips = [];
    const add = (values, type, min, max) => {
        const width = type === 'VEC4' ? 4 : type === 'VEC3' ? 3 : 1;
        json.accessors.push({ componentType: 5126, count: values.length / width, type, ...(min ? { min } : {}), ...(max ? { max } : {}) });
        streams.push({ accessor: json.accessors.at(-1), bytes: Buffer.from(values.buffer, values.byteOffset, values.byteLength), width });
        return json.accessors.length - 1;
    };
    for (const clip of json.animations) {
        const take = await readCharacterTake(json, bin, clip);
        const finished = finishCharacterTake(rig, take, clip.name, family, row.source === 'showcase');
        if (!finished) continue;
        const input = add(finished.times, 'SCALAR', [0], [take.duration]);
        for (const channel of finished.channels) {
            const width = channel.path === 'rotation' ? 4 : 3, values = Float32Array.from(channel.values);
            if (width === 4) for (let i = 1; i < finished.times.length; i++) {
                let dot = 0; for (let k = 0; k < 4; k++) dot += values[(i - 1) * 4 + k] * values[i * 4 + k];
                if (dot < 0) for (let k = 0; k < 4; k++) values[i * 4 + k] *= -1;
            }
            const tangents = studioTangents(finished.times, values, width, finished.cyclic);
            const spline = new Float32Array(finished.times.length * width * 3);
            for (let i = 0; i < finished.times.length; i++) for (let k = 0; k < width; k++) {
                spline[i * width * 3 + k] = spline[i * width * 3 + width * 2 + k] = tangents[i * width + k];
                spline[i * width * 3 + width + k] = values[i * width + k];
            }
            const sampler = { input, output: add(spline, width === 4 ? 'VEC4' : 'VEC3'), interpolation: 'CUBICSPLINE' };
            const previous = clip.channels.find(c => c.target.node === channel.node && c.target.path === channel.path);
            if (previous) clip.samplers[previous.sampler] = sampler;
            else { clip.samplers.push(sampler); clip.channels.push({ sampler: clip.samplers.length - 1, target: { node: channel.node, path: channel.path } }); }
        }
        const contactError = Math.max(0, ...finished.contacts.map(c => c.error / c.legLength));
        if (contactError > .0001) throw Error(`${row.pet.id}/${clip.name}: unreachable contact (${contactError})`);
        clips.push({ name: clip.name, keys: finished.times.length, tracks: finished.channels.length, cyclic: finished.cyclic,
            contacts: finished.contacts.length, maxContactErrorNormalized: contactError, direction: finished.direction });
    }
    // Repack every live motion stream so overwritten tracks do not keep an
    // entire historical compressed group in the delivered model. Old source
    // bytes remain in the authoring asset for review and recovery.
    const live = new Set(json.animations.flatMap(clip => clip.samplers.flatMap(s => [s.input, s.output])));
    for (const index of live) if (index < sourceAccessors) {
        const { values, width } = await readStudioAccessor(json, bin, index);
        streams.push({ accessor: json.accessors[index], bytes: Buffer.from(values.buffer, values.byteOffset, values.byteLength), width });
    }
    const chunks = [bin]; let byteLength = bin.length, rawBytes = 0, compressedBytes = 0, maxDecodedError = 0;
    let fallback = json.buffers.findIndex(buffer => buffer.extensions?.EXT_meshopt_compression?.fallback);
    if (fallback < 0) { fallback = json.buffers.length; json.buffers.push({ byteLength: 0, extensions: { EXT_meshopt_compression: { fallback: true } } }); }
    for (const width of [1, 3, 4]) {
        const group = streams.filter(stream => stream.width === width); if (!group.length) continue;
        const bytes = Buffer.concat(group.map(stream => stream.bytes)), stride = width * 4;
        const filter = width === 1 ? undefined : 'EXPONENTIAL';
        const values = new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
        const encoded = filter ? MeshoptEncoder.encodeFilterExp(values, bytes.length / stride, stride, 22, 'SharedComponent') : bytes;
        const compressed = MeshoptEncoder.encodeGltfBuffer(encoded, bytes.length / stride, stride, 'ATTRIBUTES');
        const decoded = new Uint8Array(bytes.length);
        MeshoptDecoder.decodeGltfBuffer(decoded, bytes.length / stride, stride, compressed, 'ATTRIBUTES', filter);
        const decodedValues = new Float32Array(decoded.buffer);
        const error = Math.max(...values.map((value, i) => Math.abs(value - decodedValues[i])));
        maxDecodedError = Math.max(maxDecodedError, error);
        if (width === 1 && !Buffer.from(decoded).equals(bytes) || error > .00002) throw Error('Motion precision verification failed: ' + path);
        const pad = align4(byteLength) - byteLength; if (pad) chunks.push(Buffer.alloc(pad)); byteLength += pad;
        const virtualOffset = align4(json.buffers[fallback].byteLength);
        json.buffers[fallback].byteLength = virtualOffset + bytes.length;
        let streamOffset = 0;
        for (const stream of group) {
            stream.accessor.bufferView = json.bufferViews.length; stream.accessor.byteOffset = streamOffset; streamOffset += stream.bytes.length;
        }
        json.bufferViews.push({ buffer: fallback, byteOffset: virtualOffset, byteLength: bytes.length, byteStride: stride,
            extensions: { EXT_meshopt_compression: { buffer: 0, byteOffset: byteLength, byteLength: compressed.length,
                byteStride: stride, count: bytes.length / stride, mode: 'ATTRIBUTES', ...(filter ? { filter } : {}) } } });
        chunks.push(Buffer.from(compressed)); byteLength += compressed.length; rawBytes += bytes.length; compressedBytes += compressed.length;
    }
    json.extensionsUsed ??= []; json.extensionsRequired ??= [];
    for (const list of [json.extensionsUsed, json.extensionsRequired]) if (!list.includes('EXT_meshopt_compression')) list.push('EXT_meshopt_compression');
    json.extras.characterMotion = { revision: CHARACTER_MOTION_REVISION, sourceSha256: hash(original),
        preservedPayloadBytes: bin.length, preservedPayloadSha256: hash(bin), deliveryCompression: 'meshopt-exponential-22-v1', family,
        supportChains: rig.chains.length, clips, rawCurveBytes: rawBytes, compressedCurveBytes: compressedBytes, maxDecodedError };
    json.buffers[0].byteLength = align4(byteLength);
    const binary = Buffer.concat([...chunks, Buffer.alloc(align4(byteLength) - byteLength)]);
    if (!binary.subarray(0, bin.length).equals(bin)) throw Error('Source payload changed: ' + path);
    const output = resolve(candidateRoot, relative(publicRoot, path)), bytes = encodeStudioGlb(json, binary);
    await mkdir(dirname(output), { recursive: true }); await writeFile(output + '.tmp', bytes); await rename(output + '.tmp', output);
    receipts.push({ pet: row.pet.id, path: relative(publicRoot, path).replaceAll('\\', '/'), sourceSha256: hash(original),
        candidateSha256: hash(bytes), originalBytes: original.length, bytes: bytes.length, clips: clips.length,
        tracks: clips.reduce((sum, clip) => sum + clip.tracks, 0), contactError: Math.max(...clips.map(clip => clip.maxContactErrorNormalized)) });
}
await mkdir(candidateRoot, { recursive: true });
await writeFile(resolve(candidateRoot, lod ? 'receipt-lod.json' : 'receipt-full.json'), JSON.stringify({ revision: CHARACTER_MOTION_REVISION, receipts }, null, 2));
console.log(JSON.stringify({ models: receipts.length, clips: receipts.reduce((sum, row) => sum + row.clips, 0),
    tracks: receipts.reduce((sum, row) => sum + row.tracks, 0), addedBytes: receipts.reduce((sum, row) => sum + row.bytes - row.originalBytes, 0) }));
