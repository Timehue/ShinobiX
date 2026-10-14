import { readFile, writeFile, rename } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { runtimePetModels } from './lib/pet-runtime-audit.mjs';
import { align4, parseStudioGlb, encodeStudioGlb } from './lib/pet-studio-glb.mjs';

const publicRoot = resolve(import.meta.dirname, '../public/pet-models');
const candidateRoot = resolve(import.meta.dirname, '../.tmp/pet-character-candidates/pet-models/warfront-lod');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
let models = 0, oldTextureBytes = 0, textureBytes = 0, oldPixels = 0, pixels = 0;
for (const row of new Map(runtimePetModels.map(row => [row.path, row])).values()) {
    const source = parseStudioGlb(await readFile(row.path));
    const path = resolve(candidateRoot, relative(publicRoot, row.path));
    const { json, bin } = parseStudioGlb(await readFile(path)), chunks = [bin]; let offset = bin.length;
    const images = [];
    for (const [index, image] of source.json.images.entries()) {
        if (image.mimeType !== 'image/webp' || image.bufferView === undefined) throw Error('Expected embedded WebP atlas: ' + path);
        const view = source.json.bufferViews[image.bufferView], original = source.bin.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength);
        const metadata = await sharp(original).metadata();
        const resized = await sharp(original).resize(1024, 1024, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 90, effort: 6 }).toBuffer();
        const reduced = await sharp(resized).metadata();
        if (reduced.width > 1024 || reduced.height > 1024) throw Error('Battle texture exceeds its budget');
        const pad = align4(offset) - offset; if (pad) chunks.push(Buffer.alloc(pad)); offset += pad;
        json.images[index].bufferView = json.bufferViews.length;
        json.bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: resized.length });
        chunks.push(resized); offset += resized.length;
        images.push({ sourceSha256: hash(original), sha256: hash(resized), width: reduced.width, height: reduced.height });
        oldTextureBytes += original.length; textureBytes += resized.length;
        oldPixels += metadata.width * metadata.height; pixels += reduced.width * reduced.height;
    }
    json.extras.characterMotion.battleAtlas = { revision: '20261014-battle-atlas-1024-v1', maxSize: 1024, images };
    json.buffers[0].byteLength = align4(offset);
    await writeFile(path + '.texture-tmp', encodeStudioGlb(json, Buffer.concat([...chunks, Buffer.alloc(align4(offset) - offset)])));
    await rename(path + '.texture-tmp', path); models++;
}
console.log(JSON.stringify({ models, oldTextureBytes, textureBytes, savedTextureBytes: oldTextureBytes - textureBytes, oldPixels, pixels }));
