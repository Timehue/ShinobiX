/** Remove obsolete binding/animation payloads without changing any live stream.
 * Accessor and view indices stay stable for the source repair receipts. */
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { resolve, relative, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { runtimePetModels } from './lib/pet-runtime-audit.mjs';
const client = resolve(import.meta.dirname, '..'), models = resolve(client, 'public/pet-models');
const align = n => (n + 3) & ~3, hash = bytes => createHash('sha256').update(bytes).digest('hex');
const report = [];
for (const path of new Set(runtimePetModels.flatMap(row => [row.path, resolve(models, 'warfront-lod', relative(models, row.path))]))) {
    const file = await readFile(path), size = file.readUInt32LE(12), json = JSON.parse(file.subarray(20, 20 + size)), binary = file.subarray(28 + size);
    const accessors = new Set(), views = new Set();
    const attributes = values => { for (const i of Object.values(values ?? {})) accessors.add(i); };
    for (const mesh of json.meshes ?? []) for (const primitive of mesh.primitives) { attributes(primitive.attributes); if (primitive.indices !== undefined) accessors.add(primitive.indices); for (const target of primitive.targets ?? []) attributes(target); }
    for (const skin of json.skins ?? []) if (skin.inverseBindMatrices !== undefined) accessors.add(skin.inverseBindMatrices);
    for (const animation of json.animations ?? []) for (const sampler of animation.samplers) { accessors.add(sampler.input); accessors.add(sampler.output); }
    // Historical anatomy repairs retain their original compressed bindings so
    // those tools can still restore a source before re-authoring it.
    if (!relative(models, path).replaceAll('\\', '/').startsWith('warfront-lod/')) {
        attributes(json.extras?.birdFaceRepair?.original?.attributes);
        attributes(json.extras?.crystalBearArmRepair?.attributes);
        if (json.extras?.crystalBearArmRepair?.inverseBindMatrices !== undefined) accessors.add(json.extras.crystalBearArmRepair.inverseBindMatrices);
    }
    for (const i of accessors) {
        const accessor = json.accessors[i];
        if (accessor.bufferView !== undefined) views.add(accessor.bufferView);
        if (accessor.sparse) { views.add(accessor.sparse.indices.bufferView); views.add(accessor.sparse.values.bufferView); }
    }
    for (const image of json.images ?? []) if (image.bufferView !== undefined) views.add(image.bufferView);
    const chunks = [{ offset: 0, bytes: new Uint8Array(4) }]; let offset = 4, fallbackLength = 0;
    const streamHashes = [];
    json.bufferViews = json.bufferViews.map((view, i) => {
        if (!views.has(i)) return { buffer: 0, byteOffset: 0, byteLength: 4 };
        const compression = view.extensions?.EXT_meshopt_compression;
        const bytes = compression ? binary.subarray(compression.byteOffset ?? 0, (compression.byteOffset ?? 0) + compression.byteLength) : binary.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength);
        streamHashes.push({ view: i, sha256: hash(bytes), length: bytes.length });
        chunks.push({ offset, bytes });
        if (compression) {
            compression.buffer = 0; compression.byteOffset = offset;
            view.buffer = 1; view.byteOffset = fallbackLength; fallbackLength = align(fallbackLength + view.byteLength);
        } else { view.buffer = 0; view.byteOffset = offset; }
        offset = align(offset + bytes.length); return view;
    });
    for (let i = 0; i < json.accessors.length; i++) if (!accessors.has(i)) {
        // glTF permits a zero-initialized accessor without a bufferView. Keep
        // its index/count/type valid while retiring its unused payload.
        delete json.accessors[i].bufferView; delete json.accessors[i].byteOffset; delete json.accessors[i].sparse;
        delete json.accessors[i].min; delete json.accessors[i].max;
    }
    json.buffers = [{ byteLength: offset }, ...(fallbackLength ? [{ byteLength: fallbackLength, extensions: { EXT_meshopt_compression: { fallback: true } } }] : [])];
    if (json.extras?.properAnimationSourceBoundary) json.extras.properAnimationSourceBoundary.binLength = offset;
    if (json.extras?.birdFaceRepair?.original) json.extras.birdFaceRepair.original.binLength = offset;
    if (json.extras?.crystalBearArmRepair?.boundary) json.extras.crystalBearArmRepair.boundary.binLength = offset;
    const text = Buffer.from(JSON.stringify(json)), jsonSize = align(text.length), output = Buffer.alloc(28 + jsonSize + offset);
    output.writeUInt32LE(0x46546c67, 0); output.writeUInt32LE(2, 4); output.writeUInt32LE(output.length, 8);
    output.writeUInt32LE(jsonSize, 12); output.writeUInt32LE(0x4e4f534a, 16); output.fill(32, 20, 20 + jsonSize); text.copy(output, 20);
    output.writeUInt32LE(offset, 20 + jsonSize); output.writeUInt32LE(0x004e4942, 24 + jsonSize);
    for (const chunk of chunks) output.set(chunk.bytes, 28 + jsonSize + chunk.offset);
    // Byte equality covers every live geometric, skin, texture and animation
    // payload, including compressed streams; no decoder can see a difference.
    for (const stream of streamHashes) {
        const view = json.bufferViews[stream.view], compression = view.extensions?.EXT_meshopt_compression;
        const start = 28 + jsonSize + (compression?.byteOffset ?? view.byteOffset);
        if (hash(output.subarray(start, start + stream.length)) !== stream.sha256) throw Error(`${path}: a live payload changed`);
    }
    if (output.length > file.length) continue;
    const inputSha256 = hash(file), backupRoot = resolve(client, '.tmp/pet-stream-originals');
    let backup = resolve(backupRoot, relative(models, path));
    // Later binding repairs have different live payloads. Their compaction
    // proof must refer to that exact input, while keeping older backups intact.
    if (existsSync(backup) && hash(await readFile(backup)) !== inputSha256) backup = resolve(backupRoot, '.versions', inputSha256, relative(models, path));
    await mkdir(dirname(backup), { recursive: true });
    if (!existsSync(backup)) await copyFile(path, backup);
    await writeFile(path, output);
    report.push({ path: relative(models, path), before: file.length, after: output.length, saved: file.length - output.length, beforeSha256: inputSha256, backupPath: relative(backupRoot, backup), livePayloads: streamHashes.length, livePayloadsUnchanged: true, sha256: hash(output) });
}
const manifestPath = resolve(models, 'roster-manifest.json'), manifest = JSON.parse(await readFile(manifestPath));
for (const row of report) if (row.path.replaceAll('\\', '/').startsWith('roster/')) {
    const id = row.path.split(/[\\/]/).at(-1).slice(0, -4), entry = manifest.entries[id];
    entry.sha256 = row.sha256.toUpperCase(); if (entry.validation) entry.validation.bytes = row.after;
}
await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
await writeFile(resolve(client, '.tmp/pet-stream-originals/receipt.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ compacted: report.length, savedBytes: report.reduce((sum, row) => sum + row.saved, 0), allLivePayloadsUnchanged: true }));
