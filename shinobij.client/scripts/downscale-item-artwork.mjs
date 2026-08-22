/*
 * One-off: bring public/items artwork down to the size it is actually rendered at.
 *
 * The catalog shipped at 512px for a thumbnail that paints at 64px in the shop
 * and inventory grids and 132px in the detail popup — ~11 MB of art for two
 * screens, most of it fetched on open. 320px still fully covers the 132px popup
 * at 2x DPR, so nothing softens anywhere it is displayed.
 *
 * Encode settings mirror scripts/gen-asset.mjs (the generator these came from):
 * fit inside, withoutEnlargement, WebP effort 6. Files already at or below the
 * target are left byte-identical, as is anything that would not get smaller.
 *
 *   node scripts/downscale-item-artwork.mjs [--target 320] [--quality 82] [--dry-run]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CLIENT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ITEMS_DIR = path.join(CLIENT_ROOT, 'public', 'items');

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const target = Number(flag('target', 320));
const quality = Number(flag('quality', 82));
const dryRun = argv.includes('--dry-run');

const sharp = (await import('sharp')).default;
const files = fs.readdirSync(ITEMS_DIR).filter((f) => f.endsWith('.webp')).sort();

let before = 0;
let after = 0;
let resized = 0;
let skippedSmall = 0;
let skippedNoGain = 0;

for (const name of files) {
    const file = path.join(ITEMS_DIR, name);
    const original = fs.readFileSync(file);
    before += original.length;

    const meta = await sharp(original).metadata();
    if (meta.width <= target && meta.height <= target) {
        after += original.length;
        skippedSmall++;
        continue;
    }

    const encoded = await sharp(original)
        .resize({ width: target, height: target, fit: 'inside', withoutEnlargement: true })
        .webp({ quality, effort: 6 })
        .toBuffer();

    // Never let a "compression" step make a file bigger.
    if (encoded.length >= original.length) {
        after += original.length;
        skippedNoGain++;
        continue;
    }

    // Alpha is load-bearing: these are cutouts composited over the slot frame.
    const check = await sharp(encoded).metadata();
    if (meta.hasAlpha && !check.hasAlpha) {
        throw new Error(`${name}: re-encode dropped the alpha channel`);
    }

    if (!dryRun) fs.writeFileSync(file, encoded);
    after += encoded.length;
    resized++;
}

const mb = (b) => `${(b / 1048576).toFixed(2)} MB`;
console.log(`${dryRun ? '[dry-run] ' : ''}target ${target}px q${quality}`);
console.log(`  resized ${resized}, already small ${skippedSmall}, kept (no gain) ${skippedNoGain}, total ${files.length}`);
console.log(`  ${mb(before)} -> ${mb(after)}  (${Math.round((1 - after / before) * 100)}% smaller)`);
