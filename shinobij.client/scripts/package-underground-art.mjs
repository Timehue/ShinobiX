import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
const source = resolve(process.env.USERPROFILE, '.codex/generated_images/01a12d35-3bb5-7352-9515-62574768609e');
const output = resolve('public/underground');
await mkdir(output, { recursive: true });
const walls = [
    ['exec-05bc710c-4867-42d7-95ce-66facae592c4.png', 'fortress-interior-floor-v2.webp'],
    ['exec-0380f703-f0ff-4360-b5ae-a6ef730acd7f.png', 'fortress-masonry-v1.webp'],
    ['exec-d706a8e1-06f1-4866-811b-6d8239663367.png', 'cavern-rock-face-v1.webp'],
];
for (const [file, name] of walls) await sharp(resolve(source, file)).resize(640, 640).webp({ quality: 82 }).toFile(resolve(output, name));
const sheets = [
    { file: 'exec-119d0b12-e5b4-42b1-83a1-9195c6919fa7.png', prefix: 'fortress', names: ['banner-pillar', 'brazier', 'weapon-rack', 'supplies', 'archives', 'bunk', 'gate', 'war-table', 'guardian'] },
    { file: 'exec-f4e99162-ab46-4102-8251-abe26d9581b5.png', prefix: 'cavern', names: ['stalagmites', 'broken-pillar', 'crystals', 'lantern', 'sarcophagus', 'roots', 'arch', 'offering', 'bones'] },
];
for (const sheet of sheets) {
    const file = resolve(source, sheet.file), metadata = await sharp(file).metadata();
    if (!metadata.hasAlpha) throw new Error(`${sheet.prefix} atlas must retain transparency`);
    for (let i = 0; i < 9; i++) {
        const left = Math.floor((i % 3) * metadata.width / 3), top = Math.floor(Math.floor(i / 3) * metadata.height / 3);
        const right = Math.floor((i % 3 + 1) * metadata.width / 3), bottom = Math.floor((Math.floor(i / 3) + 1) * metadata.height / 3);
        const cell = await sharp(file).extract({ left, top, width: right - left, height: bottom - top }).png().toBuffer();
        await sharp(cell).trim()
            .resize({ width: 288, height: 320, fit: 'inside' }).webp({ quality: 85, alphaQuality: 100 })
            .toFile(resolve(output, `${sheet.prefix}-${sheet.names[i]}-v1.webp`));
    }
}
console.log('Packaged 3 interior materials and 18 transparent underground fixtures.');
