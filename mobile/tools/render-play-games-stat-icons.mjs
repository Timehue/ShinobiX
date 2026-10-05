import { mkdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import sharp from 'sharp';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const iconRoot = resolve(here, '../play-games/stats-icons');
const outputRoot = resolve(process.argv[2] ?? join(iconRoot, 'png'));
const icons = [
    ['contracts', 'contracts.png'],
    ['pvp', 'pvp.png'],
    ['ai-victories', 'ai_victories.png'],
    ['pet-matches', 'pet_matches.png'],
    ['story', 'story.png'],
    ['level', 'level.png'],
];

await mkdir(outputRoot, { recursive: true });
for (const [sourceName, fileName] of icons) {
    const svg = await readFile(join(iconRoot, `${sourceName}.svg`));
    const output = join(outputRoot, fileName);
    await sharp(svg, { density: 144 })
        .resize(512, 512, { fit: 'contain' })
        .png({ compressionLevel: 9, adaptiveFiltering: true })
        .toFile(output);
    const metadata = await sharp(output).metadata();
    if (metadata.width !== 512 || metadata.height !== 512 || metadata.format !== 'png' || !metadata.hasAlpha) {
        throw new Error(`${fileName} must be a transparent 512x512 PNG; got ${metadata.width}x${metadata.height} ${metadata.format}, alpha=${metadata.hasAlpha}`);
    }
    process.stdout.write(`${fileName}: ${metadata.width}x${metadata.height} transparent PNG\n`);
}
