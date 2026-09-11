import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
const [heroSource, ceremonySource] = process.argv.slice(2);
if (!heroSource || !ceremonySource) throw new Error('Pass the generated hero and ceremony image paths.');
const destination = resolve('src/assets/dojo-circuit');
await mkdir(destination, { recursive: true });
for (const [source, name] of [[heroSource, 'dojo-hero'], [ceremonySource, 'ceremony']]) {
    await sharp(source).resize({ width: 1672, withoutEnlargement: true }).webp({ quality: 86 }).toFile(resolve(destination, `${name}.webp`));
    await sharp(source).resize({ width: 840, withoutEnlargement: true }).webp({ quality: 82 }).toFile(resolve(destination, `${name}-mobile.webp`));
}
