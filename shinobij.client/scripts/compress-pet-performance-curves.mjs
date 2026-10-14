import { readFile, writeFile, rename } from 'node:fs/promises';
import { resolve, relative, sep } from 'node:path';
import { MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';
import { runtimePetModels } from './lib/pet-runtime-audit.mjs';
import { align4, parseStudioGlb, encodeStudioGlb, readStudioAccessor } from './lib/pet-studio-glb.mjs';

await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready]);
const root = resolve(import.meta.dirname, '../public/pet-models');
const paths = [...new Set(runtimePetModels.flatMap(row => [row.path, resolve(root, 'warfront-lod', relative(root, row.path))]))];
let curves = 0, rawBytes = 0, encodedBytes = 0;
for (const path of paths) {
    const { json, bin } = parseStudioGlb(await readFile(path)), proof = json.extras.performanceRefinement;
    if (proof.deliveryCompression === 'meshopt-lossless-v2') continue;
    const chunks = [bin]; let offset = bin.length;
    const outputs = new Set();
    json.animations.forEach((clip, i) => {
        for (const channel of clip.channels.slice(proof.sourceBoundary.channels[i])) outputs.add(clip.samplers[channel.sampler].output);
    });
    const streams = [];
    for (const index of outputs) {
        const accessor = json.accessors[index], { values } = await readStudioAccessor(json, bin, index);
        if (accessor.componentType !== 5126 || accessor.type !== 'VEC4') throw Error('Expected unquantized quaternion curves');
        const bytes = new Uint8Array(values.buffer, values.byteOffset, values.byteLength);
        streams.push({ accessor, bytes: Buffer.from(bytes) });
    }
    // One stream per model removes thousands of per-track headers and lets the
    // lossless codec reuse repeated bind poses and zero spline tangents.
    const bytes = Buffer.concat(streams.map(stream => stream.bytes));
    const compressed = MeshoptEncoder.encodeGltfBuffer(bytes, bytes.length / 16, 16, 'ATTRIBUTES');
    const decoded = new Uint8Array(bytes.length);
    MeshoptDecoder.decodeGltfBuffer(decoded, bytes.length / 16, 16, compressed, 'ATTRIBUTES');
    if (!Buffer.from(decoded).equals(bytes)) throw Error('Curve compression changed a pose: ' + path);
    let fallback = json.buffers.findIndex(buffer => buffer.extensions?.EXT_meshopt_compression?.fallback);
    if (fallback < 0) { fallback = json.buffers.length; json.buffers.push({ byteLength: 0, extensions: { EXT_meshopt_compression: { fallback: true } } }); }
    const virtualOffset = align4(json.buffers[fallback].byteLength);
    json.buffers[fallback].byteLength = virtualOffset + bytes.length;
    const pad = align4(offset) - offset; if (pad) chunks.push(Buffer.alloc(pad)); offset += pad;
    let streamOffset = 0;
    for (const { accessor, bytes } of streams) {
        accessor.bufferView = json.bufferViews.length;
        accessor.byteOffset = streamOffset; streamOffset += bytes.length;
    }
    json.bufferViews.push({ buffer: fallback, byteOffset: virtualOffset, byteLength: bytes.length, byteStride: 16,
        extensions: { EXT_meshopt_compression: { buffer: 0, byteOffset: offset, byteLength: compressed.length, byteStride: 16, count: bytes.length / 16, mode: 'ATTRIBUTES' } } });
    chunks.push(Buffer.from(compressed)); offset += compressed.length;
    curves += streams.length; rawBytes += bytes.length; encodedBytes += compressed.length;
    json.extensionsUsed ??= []; json.extensionsRequired ??= [];
    for (const list of [json.extensionsUsed, json.extensionsRequired]) if (!list.includes('EXT_meshopt_compression')) list.push('EXT_meshopt_compression');
    proof.deliveryCompression = 'meshopt-lossless-v2';
    json.buffers[0].byteLength = align4(offset);
    if (!resolve(path).startsWith(root + sep)) throw Error('Delivery target escaped the model directory');
    const temporary = `${path}.delivery-tmp`;
    await writeFile(temporary, encodeStudioGlb(json, Buffer.concat([...chunks, Buffer.alloc(align4(offset) - offset)])));
    for (let attempt = 0; ; attempt++) {
        try { await rename(temporary, path); break; }
        catch (error) {
            if (attempt >= 5) throw error;
            await new Promise(resolve => setTimeout(resolve, 40 * 2 ** attempt));
        }
    }
}
console.log(JSON.stringify({ curves, rawBytes, encodedBytes, decodedCurveBytesIdentical: true }));
