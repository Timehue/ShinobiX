import { readFile, writeFile, readdir, mkdir, rename } from 'node:fs/promises';
import { resolve, relative, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { MeshoptDecoder } from 'meshoptimizer';
import { studioTangents } from './lib/pet-studio-curves.mjs';

const root = resolve(import.meta.dirname, '../public/pet-models');
const revision = '20261013-studio-v1';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const align = n => (n + 3) & ~3;
await MeshoptDecoder.ready;
async function writeManifest(path, value) {
    if (!resolve(path).startsWith(root + sep)) throw Error('Manifest target escaped the model directory');
    const temporary = `${path}.studio-tmp`;
    await writeFile(temporary, value);
    for (let attempt = 0; ; attempt++) {
        try { await rename(temporary, path); return; }
        catch (error) { if (attempt >= 5) throw error; await new Promise(resolve => setTimeout(resolve, 40 * 2 ** attempt)); }
    }
}
async function files(dir) {
    const result = [];
    for (const item of await readdir(dir, { withFileTypes: true })) {
        if (item.isDirectory() && item.name !== 'warfront-impostors') result.push(...await files(resolve(dir, item.name)));
        else if (item.name.endsWith('.glb')) result.push(resolve(dir, item.name));
    }
    return result;
}
function accessor(json, bin, index) {
    const a = json.accessors[index], v = json.bufferViews[a.bufferView];
    const width = { SCALAR: 1, VEC3: 3, VEC4: 4 }[a.type];
    const layout = { 5120: [1, 'getInt8', 127], 5121: [1, 'getUint8', 255], 5122: [2, 'getInt16', 32767], 5123: [2, 'getUint16', 65535], 5126: [4, 'getFloat32', 1] }[a.componentType];
    if (!layout || !width) throw Error('Unsupported animation accessor: ' + JSON.stringify(a));
    const [bytesPerComponent, read, divisor] = layout;
    const ext = v.extensions?.EXT_meshopt_compression;
    let bytes = bin.subarray(v.byteOffset ?? 0, (v.byteOffset ?? 0) + v.byteLength), stride = v.byteStride ?? width * bytesPerComponent;
    if (ext) {
        bytes = new Uint8Array(ext.count * ext.byteStride); stride = ext.byteStride;
        MeshoptDecoder.decodeGltfBuffer(bytes, ext.count, ext.byteStride, bin.subarray(ext.byteOffset ?? 0, (ext.byteOffset ?? 0) + ext.byteLength), ext.mode, ext.filter);
    }
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return { width, values: Float32Array.from({ length: a.count * width }, (_, i) => {
        const n = view[read]((a.byteOffset ?? 0) + Math.floor(i / width) * stride + i % width * bytesPerComponent, true);
        return a.normalized ? Math.max(-1, n / divisor) : n;
    }) };
}
const receipts = [];
for (const path of await files(root)) {
    const original = await readFile(path), length = original.readUInt32LE(12);
    const json = JSON.parse(original.subarray(20, 20 + length)), bin = original.subarray(28 + length, 28 + length + original.readUInt32LE(20 + length));
    if (json.extras?.studioPolish?.revision === revision) {
        const proof = json.extras.studioPolish;
        if (hash(bin.subarray(0, proof.preservedPayloadBytes)) !== proof.preservedPayloadSha256) throw Error(`${path}: reviewed source payload changed`);
        receipts.push({ path: relative(root, path).replaceAll('\\', '/'), curves: proof.curves, bytes: original.length, sha256: hash(original), sourcePayloadUnchanged: true });
        continue;
    }
    const chunks = [bin]; let offset = bin.length, curves = 0;
    for (const animation of json.animations ?? []) for (const sampler of animation.samplers) {
        if ((sampler.interpolation ?? 'LINEAR') !== 'LINEAR') continue;
        const times = accessor(json, bin, sampler.input).values;
        const { values, width } = accessor(json, bin, sampler.output);
        if (times.length < 2) continue;
        // Quaternion curves must follow the same hemisphere throughout the take.
        if (width === 4) for (let i = 1; i < times.length; i++) {
            let dot = 0; for (let a = 0; a < 4; a++) dot += values[(i - 1) * 4 + a] * values[i * 4 + a];
            if (dot < 0) for (let a = 0; a < 4; a++) values[i * 4 + a] *= -1;
        }
        const cyclic = ['idle', 'walk', 'gallop', 'guard', 'rest'].includes(animation.name)
            && Array.from({ length: width }, (_, a) => Math.abs(values[a] - values[values.length - width + a])).every(n => n < .0001);
        const tangent = studioTangents(times, values, width, cyclic);
        const output = new Float32Array(times.length * width * 3);
        for (let i = 0; i < times.length; i++) for (let a = 0; a < width; a++) {
            output[i * width * 3 + a] = tangent[i * width + a];
            output[i * width * 3 + width + a] = values[i * width + a];
            output[i * width * 3 + width * 2 + a] = tangent[i * width + a];
        }
        const padding = align(offset) - offset; if (padding) chunks.push(Buffer.alloc(padding)); offset += padding;
        const bytes = Buffer.from(output.buffer); chunks.push(bytes);
        json.bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length }); offset += bytes.length;
        json.accessors.push({ bufferView: json.bufferViews.length - 1, componentType: 5126, count: times.length * 3, type: width === 4 ? 'VEC4' : width === 3 ? 'VEC3' : 'SCALAR' });
        sampler.output = json.accessors.length - 1; sampler.interpolation = 'CUBICSPLINE'; curves++;
    }
    json.extras = { ...json.extras, studioPolish: { revision, curves, originalSha256: hash(original), preservedPayloadSha256: hash(bin), preservedPayloadBytes: bin.length } };
    json.buffers[0].byteLength = align(offset);
    const binary = Buffer.concat([...chunks, Buffer.alloc(align(offset) - offset)]);
    if (!binary.subarray(0, bin.length).equals(bin)) throw Error('Geometry or atlas payload changed.');
    const text = Buffer.from(JSON.stringify(json)), jsonLength = align(text.length), out = Buffer.alloc(28 + jsonLength + binary.length);
    out.writeUInt32LE(0x46546c67, 0); out.writeUInt32LE(2, 4); out.writeUInt32LE(out.length, 8);
    out.writeUInt32LE(jsonLength, 12); out.writeUInt32LE(0x4e4f534a, 16); out.fill(32, 20, 20 + jsonLength); text.copy(out, 20);
    out.writeUInt32LE(binary.length, 20 + jsonLength); out.writeUInt32LE(0x004e4942, 24 + jsonLength); binary.copy(out, 28 + jsonLength);
    await writeFile(path, out);
    receipts.push({ path: relative(root, path).replaceAll('\\', '/'), curves, originalBytes: original.length, bytes: out.length, sha256: hash(out), sourcePayloadUnchanged: true });
}
// Bind-pose geometry and embedded atlas bytes were kept verbatim above. Update
// source/LOD certificates together. Animated impostors are handled separately.
const lodPath = resolve(root, 'warfront-lod/manifest.json'), lod = JSON.parse(await readFile(lodPath));
for (const row of lod.entries) {
    const sourceBytes = await readFile(resolve(root, row.sourceUrl.split('?')[0].slice('/pet-models/'.length)));
    const lodBytes = await readFile(resolve(root, row.lodUrl.split('?')[0].slice('/pet-models/'.length)));
    row.sourceSha256 = hash(sourceBytes); row.sourceBytes = sourceBytes.length;
    row.lodSha256 = hash(lodBytes); row.lodBytes = lodBytes.length;
    row.lodUrl = `${row.lodUrl.split('?')[0]}?v=${lod.revision}-${row.sourceSha256.slice(0, 12)}-${row.lodSha256.slice(0, 12)}`;
}
await writeManifest(lodPath, JSON.stringify(lod, null, 2) + '\n');
// Animated impostor poses must be rerendered after this pass, using
// generate-warfront-pet-impostors.mjs. Do not relabel old pose pixels as reviewed.
const atlasPath = resolve(root, 'warfront-impostors/manifest.json'), atlas = JSON.parse(await readFile(atlasPath));
if (atlas.entries.every(row => lod.entries.find(p => p.sourceUrl === row.sourceUrl)?.lodSha256 === row.lodSha256)) {
    for (const row of atlas.entries) row.lodUrl = lod.entries.find(p => p.sourceUrl === row.sourceUrl).lodUrl;
    await writeManifest(atlasPath, JSON.stringify(atlas, null, 2) + '\n');
}
const rosterPath = resolve(root, 'roster-manifest.json'), roster = JSON.parse(await readFile(rosterPath));
for (const [id, row] of Object.entries(roster.entries)) {
    const path = resolve(root, `roster/${id}.glb`), bytes = await readFile(path);
    row.sha256 = hash(bytes).toUpperCase(); if (row.validation) row.validation.bytes = bytes.length;
}
await writeManifest(rosterPath, JSON.stringify(roster, null, 2) + '\n');
await mkdir(resolve(root, '../../.tmp/pet-studio-review'), { recursive: true });
await writeFile(resolve(root, '../../.tmp/pet-studio-review/asset-receipt.json'), JSON.stringify(receipts, null, 2));
console.log(JSON.stringify({ assets: receipts.length, curves: receipts.reduce((n, r) => n + r.curves, 0), geometryAndAtlasBytesPreserved: true }));
