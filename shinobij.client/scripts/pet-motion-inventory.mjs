import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import sharp from 'sharp';
import { runtimePetModels } from './lib/pet-runtime-audit.mjs';

const output = resolve(import.meta.dirname, '../../docs/pet-motion-evidence');
await mkdir(output, { recursive: true });
const models = [];
for (const { pet, model, path, source } of runtimePetModels) {
    const bytes = await readFile(path);
    const size = bytes.readUInt32LE(12);
    const gltf = JSON.parse(bytes.subarray(20, 20 + size));
    const binary = bytes.subarray(28 + size);
    const textures = [];
    for (const image of gltf.images ?? []) {
        const view = gltf.bufferViews[image.bufferView];
        const metadata = await sharp(binary.subarray(view.byteOffset, view.byteOffset + view.byteLength)).metadata();
        textures.push({ width: metadata.width, height: metadata.height, bytes: view.byteLength, format: metadata.format });
    }
    models.push({ id: pet.id, name: pet.name, family: model.profile, source, url: model.url, bytes: bytes.length,
        skins: (gltf.skins ?? []).map(s => s.joints.length), bones: (gltf.skins ?? []).flatMap(s => s.joints.map(i => gltf.nodes[i].name)),
        clips: (gltf.animations ?? []).map(a => ({ name: a.name, channels: a.channels.length, targets: [...new Set(a.channels.map(c => gltf.nodes[c.target.node].name))] })),
        triangles: (gltf.meshes ?? []).flatMap(m => m.primitives).reduce((sum, p) => sum + (p.indices === undefined ? gltf.accessors[p.attributes.POSITION].count : gltf.accessors[p.indices].count) / 3, 0),
        primitives: (gltf.meshes ?? []).flatMap(m => m.primitives).length, materials: gltf.materials?.length ?? 0, textures,
        extensions: gltf.extensionsUsed ?? [], extras: gltf.extras });
}
const summary = { identities: models.length, uniqueUrls: new Set(models.map(m => m.url)).size,
    skinned: models.filter(m => m.skins.length).length, static: models.filter(m => !m.skins.length).length,
    totalBytes: models.reduce((sum, m) => sum + m.bytes, 0), triangles: models.reduce((sum,m) => sum+m.triangles,0),
    minBytes: Math.min(...models.map(m => m.bytes)), maxBytes: Math.max(...models.map(m => m.bytes)),
    families: Object.fromEntries([...new Set(models.map(m => m.family))].map(f => [f, models.filter(m => m.family === f).length])),
    clipCounts: [...new Set(models.map(m => m.clips.length))], maxTriangles: Math.max(...models.map(m => m.triangles)),
    textures: [...new Set(models.flatMap(m => m.textures.map(t => `${t.width}x${t.height} ${t.format}`)))] };
await writeFile(resolve(output, 'inventory.json'), JSON.stringify({ summary, models }, null, 2) + '\n');
console.log(JSON.stringify(summary));
for (const id of ['standard-0','standard-3','standard-7','rare-1','starter-lightning-l','starter-water','legendary-0']) {
    const m = models.find(m => m.id === id);
    console.log(JSON.stringify({id, name:m?.name, bones:m?.bones, clips:m?.clips.map(c=>c.name)}));
}
