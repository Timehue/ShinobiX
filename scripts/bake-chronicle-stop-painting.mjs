import sharp from 'sharp';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const source = process.argv[2];
if (!source) throw new Error('Pass the full-sector tabletop edit.');
const directory = 'output/living-world/painted', slug = 'midlands-chronicle-table-v1';
const baseFile = 'shinobij.client/public/sector-life/midlands-tea-stop-v1.webp';
const box = { left: 270, top: 737, width: 71, height: 50 };
const base = await readFile(baseFile), provider = await readFile(source);
const normalized = await sharp(provider).resize(1024, 1024, { fit: 'fill' }).png().toBuffer();
const patch = await sharp(normalized).extract(box).removeAlpha().png().toBuffer();
const composed = await sharp(base).composite([{ input: patch, left: box.left, top: box.top }]).removeAlpha().png().toBuffer();
const original = await sharp(base).removeAlpha().raw().toBuffer(), pixels = await sharp(composed).raw().toBuffer();
let changedOutside = 0;
for (let y = 0; y < 1024; y++) for (let x = 0; x < 1024; x++) if (x < box.left || x >= box.left + box.width || y < box.top || y >= box.top + box.height)
    for (let c = 0; c < 3; c++) if (original[(y * 1024 + x) * 3 + c] !== pixels[(y * 1024 + x) * 3 + c]) changedOutside++;
if (changedOutside) throw new Error('Tabletop edit changed protected terrain.');
await mkdir(`${directory}/sources`, { recursive: true });
await writeFile(`${directory}/sources/${slug}-provider.png`, provider);
await writeFile(`${directory}/${slug}.png`, composed);
// Lossless delivery keeps all protected terrain pixels identical to the base.
const delivered = await sharp(composed).webp({ lossless: true }).toBuffer();
await writeFile(`shinobij.client/public/sector-life/${slug}.webp`, delivered);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const receipt = { sector: 42, baseFile, baseSha256: hash(base), deliveredSha256: hash(delivered), provider: 'built-in image_gen',
    source: `${directory}/sources/${slug}-provider.png`, sourceSha256: hash(provider), box, changedOutside, bytes: delivered.length,
    prompt: 'Use case: precise-object-edit. Edit target is the FIRST image: the complete square overhead Midlands game-sector painting. SECOND image is a supporting reference for the backs of the tiny Chronicle playing cards. Deliver the full square sector at the exact same overhead framing and game-art scale. Change ONLY the existing tiny wooden tea TABLE TOP near (30% across, 74% down). Keep the existing table, mats, basket, kettle and cup and every terrain feature in exactly the same place. On the free middle/left part of that table top paint a modest arrangement of FOUR tiny playing cards and two very small deck stacks for a two-person Chronicle card match, with opponents sitting on the existing mats left and right. The cards are physically flat on the wood, correctly foreshortened for this overhead view, each card only about one-sixth the table width, with muted black/brown-and-gold backs and hints of blue/red derived from the reference. Keep the kettle on the rear right of the table; the cup may shift a few pixels toward the rear left to make room. Match the existing worn painterly detail, soft sunlight, small contact shadows, and materials. The result must look painted into this exact map, with no brighter outline, no enlarged cards, no icon, no labels. Preserve every rock, grass patch, paving edge, road, exit and frame. Do not add any people or any other objects. No UI or text.', visualReview: 'pending-in-game' };
await writeFile(`${directory}/${slug}.json`, JSON.stringify(receipt, null, 2) + '\n');
console.log(JSON.stringify(receipt));
