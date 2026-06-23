// Asset cleanup #2: strip the OPAQUE DARK background some pose sprites shipped
// with. Unlike clean-pose-bg.mjs (which samples only the 4 CORNERS and skips
// anything corner-transparent), several poses have transparent corners but a
// solid near-black bg filling the rest of the frame (e.g. rare-11 the blue
// dragon). The board renderer can't alpha-cut that, and a luminance key would
// shred the pet's own dark pixels — so the fix is to make the background truly
// transparent here, at the source.
//
// Algorithm (safe for clean pets): flood-fill inward from the border, but ONLY
// across pixels that are OPAQUE *and* near-black (the bg). Seeds are border
// pixels matching that description. A clean pet (transparent border, no opaque
// dark bg) yields no seeds → nothing changes. A bright subject (the dragon)
// stops the fill at its silhouette. Idempotent; only `-idle.webp` (what the
// Gauntlet board uses) is processed.
//   run:  cd shinobij.client && node scripts/clean-pose-darkbg.mjs
import sharp from "sharp";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIR = path.resolve(HERE, "../public/pet-poses");
const DARK = 60;       // a pixel is "dark bg" if max(R,G,B) <= DARK …
const FILES = fs.readdirSync(DIR).filter((f) => f.endsWith("-idle.webp"));
let cleaned = 0, skipped = 0;

for (const f of FILES) {
    const fp = path.join(DIR, f);
    // Read through fs (NOT sharp(path)) so no file handle lingers to block the
    // write-back on Windows.
    const { data, info } = await sharp(fs.readFileSync(fp)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const { width, height, channels } = info;
    const idx = (x, y) => (y * width + x) * channels;
    const isDarkOpaque = (i) => data[i + 3] > 200 && data[i] <= DARK && data[i + 1] <= DARK && data[i + 2] <= DARK;

    // Seed the fill from every border pixel that is opaque + near-black.
    const seen = new Uint8Array(width * height);
    const stack = [];
    const pushIf = (x, y) => { if (x >= 0 && y >= 0 && x < width && y < height && isDarkOpaque(idx(x, y))) stack.push(x, y); };
    for (let x = 0; x < width; x++) { pushIf(x, 0); pushIf(x, height - 1); }
    for (let y = 0; y < height; y++) { pushIf(0, y); pushIf(width - 1, y); }
    if (!stack.length) { skipped++; continue; }   // no opaque dark border → already clean

    let removed = 0;
    while (stack.length) {
        const y = stack.pop(); const x = stack.pop();
        const p = y * width + x; if (seen[p]) continue; seen[p] = 1;
        const i = p * channels; if (!isDarkOpaque(i)) continue;   // stop at the (brighter) subject
        data[i + 3] = 0; removed++;
        pushIf(x + 1, y); pushIf(x - 1, y); pushIf(x, y + 1); pushIf(x, y - 1);
    }
    if (!removed) { skipped++; continue; }
    const out = await sharp(data, { raw: { width, height, channels } }).webp({ quality: 92 }).toBuffer();
    fs.writeFileSync(fp, out);
    cleaned++;
    console.log("cleaned", f, `(${removed}px)`);
}
console.log(`\n${cleaned} cleaned, ${skipped} already-clean (of ${FILES.length}).`);
