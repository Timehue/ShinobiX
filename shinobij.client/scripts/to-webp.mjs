// Convert PNG/JPG background art to WebP (q80) — keeps decorative backgrounds
// tiny without a visible quality drop (they sit behind dark gradient overlays).
//
// Run from shinobij.client/ (that's where `sharp` is installed):
//   node scripts/to-webp.mjs <img...>            # write <name>.webp next to each
//   node scripts/to-webp.mjs --delete <img...>   # also remove the source PNG/JPG
//
// After converting, update the references (the import specifier or the CSS
// url('...')) from `.png` to `.webp`. The Vite image-optimizer is configured to
// SKIP .webp (see vite.config.ts `exclude`), so this q80 output is final — no
// double re-encode. WebP is supported by every current browser, so no <picture>
// fallback is needed. (Leave Shinobi-Journeys.png as PNG — it's the og:image
// social-preview, and some link-unfurl crawlers don't accept WebP.)
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const del = args.includes('--delete');
const files = args.filter((a) => a !== '--delete');

if (!files.length) {
    console.error('usage: node scripts/to-webp.mjs [--delete] <img...>');
    process.exit(1);
}

let before = 0;
let after = 0;
for (const src of files) {
    if (!fs.existsSync(src)) { console.log('SKIP (missing):', src); continue; }
    const out = src.replace(/\.(png|jpe?g)$/i, '.webp');
    if (out === src) { console.log('SKIP (not png/jpg):', src); continue; }
    const b = fs.statSync(src).size;
    await sharp(src).webp({ quality: 80, effort: 6 }).toFile(out);
    const a = fs.statSync(out).size;
    before += b;
    after += a;
    console.log(`${path.basename(src)}: ${(b / 1024 | 0)}KB -> ${(a / 1024 | 0)}KB  (-${(100 - a / b * 100).toFixed(0)}%)`);
    if (del) fs.unlinkSync(src);
}
console.log(`TOTAL: ${(before / 1024 / 1024).toFixed(1)}MB -> ${(after / 1024 / 1024).toFixed(1)}MB`);
