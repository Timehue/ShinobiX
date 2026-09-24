/** Decode the shipping Raijin GLB for Blender's importer, which lacks meshopt. */
import { resolve } from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';

const [source, output] = process.argv.slice(2);
if (!source || !output) throw new Error('Usage: node scripts/decode-raijin-animation-source.mjs SOURCE.glb OUTPUT.glb');
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
// The shipping meshopt GLB omits fallback bytes. Add empty resources while
// decoding, then put every decoded accessor on one real output buffer.
const jsonDoc = await io.readAsJSON(resolve(source));
const maxBufferIndex = Math.max(-1, ...(jsonDoc.json.bufferViews ?? []).map((view) => view.buffer ?? -1));
while ((jsonDoc.json.buffers?.length ?? 0) <= maxBufferIndex) {
    const index = jsonDoc.json.buffers?.length ?? 0;
    const uri = `__raijin_meshopt_fallback_${index}.bin`;
    jsonDoc.json.buffers ??= [];
    jsonDoc.json.buffers.push({ byteLength: 0, uri });
    jsonDoc.resources[uri] = new Uint8Array(0);
}
const document = await io.readJSON(jsonDoc);
const root = document.getRoot();
const buffers = root.listBuffers();
const target = buffers[0] ?? document.createBuffer('raijin-animation-source');
for (const accessor of root.listAccessors()) accessor.setBuffer(target);
for (const buffer of buffers.slice(1)) buffer.dispose();
for (const extension of document.getRoot().listExtensionsUsed()) {
    if (extension.extensionName === 'EXT_meshopt_compression') extension.dispose();
}
await io.write(resolve(output), document);
console.log('Decoded Blender import:', resolve(output));
