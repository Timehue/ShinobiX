/** Compress a reviewed rigged Raijin GLB without changing its topology. */
import { resolve } from 'node:path';
import { stat } from 'node:fs/promises';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { meshopt, textureCompress } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';

const [, , inputArg, outputArg] = process.argv;
if (!inputArg || !outputArg) throw new Error('Usage: node scripts/optimize-raijin-pro-candidate.mjs INPUT.glb OUTPUT.glb');
const input = resolve(inputArg), output = resolve(outputArg);
if (input === output) throw new Error('Input and output must differ');
await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready]);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'meshopt.decoder': MeshoptDecoder,
  'meshopt.encoder': MeshoptEncoder,
});
const doc = await io.read(input);
doc.getRoot().setExtras({
  ...doc.getRoot().getExtras(),
  raijinSculptRevision: '20260923-multiview-sculpt-v1',
  raijinSource: 'art-source/raijin-hound/pro-generation-candidate.glb',
  raijinRigSource: 'art-source/raijin-hound/raijin-pro-rig-candidate-v3.blend',
});
await doc.transform(
  textureCompress({ encoder: sharp, targetFormat: 'webp', quality: 94, effort: 6 }),
  meshopt({ encoder: MeshoptEncoder, level: 'high' }),
);
await io.write(output, doc);
console.log(JSON.stringify({ input, output, inputBytes: (await stat(input)).size, outputBytes: (await stat(output)).size }));
