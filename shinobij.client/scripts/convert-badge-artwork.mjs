/*
 * One-off: re-encode public/badges from PNG to WebP.
 *
 * The badge set shipped as 165 uncompressed 256px PNGs averaging 121 KB — 19.6 MB
 * for icons that render at 30-54px. Opening Profile pulled 32 of them (1.16 MB)
 * because achievements render as a grid.
 *
 * Resolution is deliberately UNCHANGED at 256px: this is a codec swap, not a
 * downscale, so there is no quality tradeoff to weigh anywhere they are drawn.
 * Encode settings mirror scripts/gen-asset.mjs (WebP q82, effort 6) the same way
 * downscale-item-artwork.mjs does.
 *
 * Writes <name>.webp beside each <name>.png, then removes the PNG. Every render
 * site carries an onError fallback, so a stale reference degrades to the initials
 * placeholder rather than a broken image — but `--check` below verifies none are
 * left before anything is deleted.
 *
 *   node scripts/convert-badge-artwork.mjs [--quality 82] [--dry-run] [--keep-png]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CLIENT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BADGE_DIR = path.join(CLIENT_ROOT, 'public', 'badges');

const argv = process.argv.slice(2);
const flagValue = (name, fallback) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const quality = Number(flagValue('quality', 82));
const dryRun = argv.includes('--dry-run');
const keepPng = argv.includes('--keep-png');

const sharp = (await import('sharp')).default;
const pngs = fs.readdirSync(BADGE_DIR).filter((f) => /\.png$/i.test(f)).sort();

let before = 0;
let after = 0;
let converted = 0;
const skipped = [];

for (const name of pngs) {
    const src = path.join(BADGE_DIR, name);
    const original = fs.readFileSync(src);
    before += original.length;

    const meta = await sharp(original).metadata();
    const encoded = await sharp(original).webp({ quality, effort: 6 }).toBuffer();

    // A "compression" step that grows a file is a bug, not an optimisation.
    if (encoded.length >= original.length) {
        after += original.length;
        skipped.push(`${name} (webp was larger)`);
        continue;
    }
    // Badges are drawn over themed panels; losing alpha would paint a box.
    const check = await sharp(encoded).metadata();
    if (meta.hasAlpha && !check.hasAlpha) throw new Error(`${name}: re-encode dropped the alpha channel`);
    if (check.width !== meta.width || check.height !== meta.height) {
        throw new Error(`${name}: resolution changed ${meta.width}x${meta.height} -> ${check.width}x${check.height}`);
    }

    if (!dryRun) {
        fs.writeFileSync(path.join(BADGE_DIR, name.replace(/\.png$/i, '.webp')), encoded);
        if (!keepPng) fs.unlinkSync(src);
    }
    after += encoded.length;
    converted++;
}

const mb = (b) => `${(b / 1048576).toFixed(2)} MB`;
console.log(`${dryRun ? '[dry-run] ' : ''}WebP q${quality}, resolution unchanged`);
console.log(`  converted ${converted} of ${pngs.length}${skipped.length ? `, kept ${skipped.length}: ${skipped.join(', ')}` : ''}`);
console.log(`  ${mb(before)} -> ${mb(after)}  (${Math.round((1 - after / before) * 100)}% smaller)`);
