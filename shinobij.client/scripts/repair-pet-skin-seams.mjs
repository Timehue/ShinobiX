import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { resolve, basename, relative, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import { repairPetSkinWeights, repairPetSkinEdges } from '../src/lib/pet-skin-weight-repair.ts';
import { runtimePetModels } from './lib/pet-runtime-audit.mjs';
await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready]);
export async function repairAsset(source, destination, iterations = 48, pairs = null) {
if (source === destination) throw Error('Repair to a candidate file first.');
const bytes = await readFile(source), jsonLength = bytes.readUInt32LE(12);
const json = JSON.parse(bytes.subarray(20, 20 + jsonLength));
const binary = bytes.subarray(28 + jsonLength);
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
loader.register(() => ({ name: 'EXT_texture_webp', loadTexture: () => Promise.resolve(null) }));
const gltf = await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
const meshes = []; gltf.scene.traverse(node => { if (node.isSkinnedMesh) meshes.push(node); });
const mesh = meshes[0];
if (json.extras?.skinSeamRepair && !pairs) throw Error('Already repaired: start from the recorded original source.');
const headJoint = mesh.skeleton.bones.findIndex(b => b.name === 'head');
const repair = pairs && iterations === 0 ? repairPetSkinEdges(mesh.geometry, mesh.skeleton.bones.length, pairs, headJoint) : repairPetSkinWeights(mesh.geometry, mesh.skeleton.bones.length, headJoint, iterations, pairs ?? undefined);
const align = n => (n + 3) & ~3;
let offset = align(binary.length);
const chunks = [{ offset: 0, bytes: binary }];
for (const [name, type] of [['skinIndex', 'JOINTS_0'], ['skinWeight', 'WEIGHTS_0']]) {
    const original = repair.geometry.getAttribute(name).array;
    const array = Uint8Array.from(original, value => name === 'skinWeight' ? Math.round(value * 255) : value);
    if (name === 'skinWeight') for (let v = 0; v < array.length; v += 4) {
        const sum = array[v] + array[v + 1] + array[v + 2] + array[v + 3];
        array[v] += 255 - sum; // largest influence receives rounding remainder
    }
    const componentType = 5121, stride = 4;
    const raw = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
    const compressed = MeshoptEncoder.encodeGltfBuffer(raw, array.length / 4, stride, 'ATTRIBUTES');
    const view = json.bufferViews.length;
    // Required meshopt assets use a virtual fallback buffer, avoiding a second
    // uncompressed copy of every weight stream in the download.
    let fallbackBuffer = json.buffers.findIndex(b => b.extensions?.EXT_meshopt_compression?.fallback);
    if (fallbackBuffer < 0) { fallbackBuffer = json.buffers.length; json.buffers.push({ byteLength: 0, extensions: { EXT_meshopt_compression: { fallback: true } } }); }
    const fallback = align(json.buffers[fallbackBuffer].byteLength); json.buffers[fallbackBuffer].byteLength = fallback + raw.byteLength;
    chunks.push({ offset, bytes: compressed }); const encoded = offset; offset = align(offset + compressed.byteLength);
    json.bufferViews.push({ buffer: fallbackBuffer, byteOffset: fallback, byteLength: raw.byteLength, byteStride: stride, target: 34962,
        extensions: { EXT_meshopt_compression: { buffer: 0, byteOffset: encoded, byteLength: compressed.byteLength, byteStride: stride, count: array.length / 4, mode: 'ATTRIBUTES' } } });
    json.meshes[0].primitives[0].attributes[type] = json.accessors.length;
    json.accessors.push({ bufferView: view, componentType, count: array.length / 4, type: 'VEC4', ...(name === 'skinWeight' ? { normalized: true } : {}) });
}
json.buffers[0].byteLength = offset;
json.extras.skinSeamRepair = pairs ? { sourceSha256: createHash('sha256').update(bytes).digest('hex'), ...json.extras.skinSeamRepair, revision: '20261012-connected-weight-v2', localizedSeamVertices: (json.extras.skinSeamRepair?.localizedSeamVertices ?? 0) + repair.changedVertices } : { revision: '20261012-connected-weight-v1', source: basename(source), sourceSha256: createHash('sha256').update(bytes).digest('hex'), changedVertices: repair.changedVertices, iterations: repair.iterations };
// A future animation re-author must retain the repaired binding streams.
if (json.extras.properAnimationSourceBoundary) json.extras.properAnimationSourceBoundary = { binLength: offset, accessorCount: json.accessors.length, bufferViewCount: json.bufferViews.length };
const text = Buffer.from(JSON.stringify(json)), size = align(text.length), output = Buffer.alloc(28 + size + offset);
output.writeUInt32LE(0x46546c67, 0); output.writeUInt32LE(2, 4); output.writeUInt32LE(output.length, 8);
output.writeUInt32LE(size, 12); output.writeUInt32LE(0x4e4f534a, 16); output.fill(32, 20, 20 + size); text.copy(output, 20);
output.writeUInt32LE(offset, 20 + size); output.writeUInt32LE(0x004e4942, 24 + size);
for (const chunk of chunks) output.set(chunk.bytes, 28 + size + chunk.offset);
await mkdir(resolve(destination, '..'), { recursive: true }); await writeFile(destination, output);
return { source, destination, changedVertices: repair.changedVertices, bytes: output.length, sourceBytes: bytes.length };
}

if (resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
if (process.argv.includes('--all') || process.argv.includes('--remaining')) {
    const modelRoot = resolve(import.meta.dirname, '../public/pet-models');
    const destinationRoot = resolve(import.meta.dirname, '../.tmp/pet-skin-candidates');
    const baseline = JSON.parse(await readFile(resolve(import.meta.dirname, '../.tmp/pet-animation-audit/all-pet-motion-audit.json')));
    const damaged = new Set(baseline.deformationWarnings.map(w => w.assetId));
    const remaining = process.argv.includes('--remaining') ? JSON.parse(await readFile(resolve(import.meta.dirname, '../.tmp/pet-animation-audit/all-pet-repaired-motion-audit.json'))) : null;
    const remainingIds = remaining ? new Set(remaining.deformationWarnings.map(w => w.assetId)) : null;
    const unique = [...new Map(runtimePetModels.map(row => [row.path, row])).values()].filter(row => !remainingIds || remainingIds.has(row.model.visualId));
    const report = [];
    for (const [i, row] of unique.entries()) {
        const destination = resolve(destinationRoot, relative(modelRoot, row.path));
        await mkdir(dirname(destination), { recursive: true });
        if (damaged.has(row.model.visualId)) report.push(await repairAsset(row.path, destination, remaining ? 144 : 48));
        else { await copyFile(row.path, destination); report.push({ source: row.path, destination, unchanged: true }); }
        if ((i + 1) % 20 === 0) console.log(`Prepared ${i + 1}/${unique.length} skin candidates`);
    }
    await writeFile(resolve(destinationRoot, remaining ? 'refinement-report.json' : 'repair-report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ candidates: report.length, repaired: report.filter(r => !r.unchanged).length, addedBytes: report.reduce((sum, r) => sum + (r.bytes ?? 0) - (r.sourceBytes ?? 0), 0) }));
} else if (process.argv.includes('--finish')) {
    const report = JSON.parse(await readFile(resolve(process.argv[2])));
    const pairs = report.deformationWarnings.flatMap(w => w.worstEdges?.map(e => e.vertices) ?? []);
    if (!pairs.length) throw Error('No measured seam vertices in this report.');
    const source = resolve(process.argv[3]), destination = resolve(process.argv[4]);
    console.log(JSON.stringify(await repairAsset(source, destination, 0, pairs)));
} else {
    console.log(JSON.stringify(await repairAsset(resolve(process.argv[2]), resolve(process.argv[3]), Number(process.argv[4] ?? 48))));
}
}
