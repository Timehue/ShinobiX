import { readFile, mkdir } from 'node:fs/promises';
import sharp from 'sharp';

const manifest = JSON.parse(await readFile('../docs/art/fortress-room-maps-v3.json', 'utf8'));
await mkdir('public/underground', { recursive: true });
for (const room of manifest.records) {
    const normalized = await sharp(room.source).resize(1120, 800, { fit: 'fill' }).png().toBuffer();
    for (const outputPath of room.outputs) {
        const output = outputPath.replace('shinobij.client/', '');
        const side = output.includes('-north-') ? 'north' : output.includes('-south-') ? 'south' : 'floor';
        const height = side === 'north' ? 160 : side === 'south' ? room.key === 'cistern' ? 304 : 224 : 800;
        await sharp(normalized).extract({ left: 0, top: side === 'south' ? 800 - height : 0, width: 1120, height })
            .webp({ quality: 82 }).toFile(output);
        console.log(output);
    }
}
const entry = manifest.records.find(room => room.key === 'entry-hall');
const metadata = await sharp(entry.source).metadata();
const size = Math.round(metadata.width / 7);
await sharp(entry.source).extract({ left: Math.round(metadata.width * .42), top: Math.round(metadata.height * .4), width: size, height: size })
    .resize(320, 320).webp({ quality: 82 }).toFile('public/underground/fortress-corridor-floor-v3.webp');
