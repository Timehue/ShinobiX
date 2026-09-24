/** Convert transparent Blender pose renders into one consistently framed set. */
import { mkdir, readFile } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import sharp from 'sharp';

const [inputArg, outputArg, portraitArg, reviewArg] = process.argv.slice(2);
if (!inputArg || !outputArg || !portraitArg) {
    throw new Error('Usage: node scripts/finalize-raijin-pose-sprites.mjs RENDER_DIRECTORY POSE_OUTPUT_DIRECTORY PORTRAIT_OUTPUT.webp');
}
const input = resolve(inputArg), output = resolve(outputArg), portraitOutput = resolve(portraitArg);
const reviewOutput = resolve(reviewArg ?? join(output, 'raijin-pose-review.png'));
await mkdir(output, { recursive: true });
await mkdir(dirname(portraitOutput), { recursive: true });
await mkdir(dirname(reviewOutput), { recursive: true });
const categories = ['idle', 'attack', 'hurt', 'cast', 'run-a', 'run-b', 'windup', 'lunge', 'impact', 'recover'];
const files = categories.map(category => join(input, `starter-lightning-l-${category}.png`));
const images = await Promise.all(files.map(async path => {
    const { data, info } = await sharp(path).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    return { path, data, info };
}));
const bounds = { left: Infinity, top: Infinity, right: -1, bottom: -1 };
for (const { data, info } of images) {
    if (info.width !== 512 || info.height !== 512 || info.channels !== 4) throw new Error('Unexpected Raijin pose render dimensions');
    for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
        if (data[(y * info.width + x) * 4 + 3] < 12) continue;
        bounds.left = Math.min(bounds.left, x);
        bounds.top = Math.min(bounds.top, y);
        bounds.right = Math.max(bounds.right, x);
        bounds.bottom = Math.max(bounds.bottom, y);
    }
}
if (!Number.isFinite(bounds.left)) throw new Error('Raijin pose renders have no visible pixels');
const margin = 18;
const left = Math.max(0, bounds.left - margin), top = Math.max(0, bounds.top - margin);
const right = Math.min(511, bounds.right + margin), bottom = Math.min(511, bounds.bottom + margin);
const crop = { left, top, width: right - left + 1, height: bottom - top + 1 };
for (let index = 0; index < images.length; index++) {
    const destination = join(output, `starter-lightning-l-${categories[index]}.webp`);
    await sharp(images[index].path).extract(crop).resize(384, 384, {
        fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 },
    }).webp({ quality: 89, alphaQuality: 100, effort: 5 }).toFile(destination);
}
const portraitSource = resolve(import.meta.dirname, '../art-source/raijin-hound/views/three-quarter.png');
await sharp(portraitSource).resize(512, 512, {
    fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 },
}).webp({ quality: 91, alphaQuality: 100, effort: 5 }).toFile(portraitOutput);

const tile = 320, sheet = sharp({ create: { width: tile * 5, height: tile * 2, channels: 4, background: '#182337' } });
const layers = await Promise.all(categories.map(async (category, index) => {
    const sprite = await readFile(join(output, `starter-lightning-l-${category}.webp`));
    const art = await sharp(sprite).resize(296, 296).toBuffer();
    const label = Buffer.from(`<svg width="${tile}" height="${tile}" xmlns="http://www.w3.org/2000/svg"><rect x="8" y="8" width="170" height="34" rx="7" fill="#07101c" fill-opacity="0.85"/><text x="20" y="32" font-family="Arial" font-size="21" font-weight="bold" fill="white">${category.toUpperCase()}</text></svg>`);
    const x = (index % 5) * tile, y = Math.floor(index / 5) * tile;
    return [{ input: art, left: x + 12, top: y + 12 }, { input: label, left: x, top: y }];
}));
await sheet.composite(layers.flat()).png().toFile(reviewOutput);
console.log(JSON.stringify({ crop, poses: categories.length, output, portraitOutput, reviewOutput }, null, 2));
