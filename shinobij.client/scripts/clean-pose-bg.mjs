// One-off asset cleanup: make the SOLID background of pet idle poses transparent.
// Some generated/sliced poses shipped with an opaque black or white background
// (the original white-key missed them) → they render as a dark/white box on the
// board + placement grid. This samples the corners to detect the background
// colour, flood-fills the connected background from the edges (so it never eats
// into the subject), and re-saves with alpha. Already-transparent poses are
// skipped, so only the broken ones change. Idempotent.
//   run:  cd shinobij.client && node scripts/clean-pose-bg.mjs
import sharp from "sharp";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIR = path.resolve(HERE, "../public/pet-poses");
const TOL = 40;            // colour-match tolerance for "is background"
const files = fs.readdirSync(DIR).filter((f) => f.endsWith("-idle.webp"));
let cleaned = 0, skipped = 0;

for (const f of files) {
    const fp = path.join(DIR, f);
    const { data, info } = await sharp(fp).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const { width, height, channels } = info;
    const at = (x, y) => (y * width + x) * channels;
    const corners = [[0, 0], [width - 1, 0], [0, height - 1], [width - 1, height - 1]].map(([x, y]) => { const i = at(x, y); return [data[i], data[i + 1], data[i + 2], data[i + 3]]; });
    // Already transparent at the corners → nothing to do.
    if (corners.every((c) => c[3] < 24)) { skipped++; continue; }
    const opaque = corners.filter((c) => c[3] > 200);
    if (!opaque.length) { skipped++; continue; }
    const bg = [0, 1, 2].map((k) => Math.round(opaque.reduce((s, c) => s + c[k], 0) / opaque.length));
    const isBg = (i) => data[i + 3] > 0 && Math.abs(data[i] - bg[0]) <= TOL && Math.abs(data[i + 1] - bg[1]) <= TOL && Math.abs(data[i + 2] - bg[2]) <= TOL;

    // Flood-fill the background region inward from every edge pixel.
    const seen = new Uint8Array(width * height);
    const stack = [];
    for (let x = 0; x < width; x++) { stack.push(x, 0, x, height - 1); }
    for (let y = 0; y < height; y++) { stack.push(0, y, width - 1, y); }
    while (stack.length) {
        const y = stack.pop(); const x = stack.pop();
        if (x < 0 || y < 0 || x >= width || y >= height) continue;
        const p = y * width + x; if (seen[p]) continue; seen[p] = 1;
        const i = p * channels; if (!isBg(i)) continue;
        data[i + 3] = 0;
        stack.push(x + 1, y, x - 1, y, x, y + 1, x, y - 1);
    }
    await sharp(data, { raw: { width, height, channels } }).webp({ quality: 92 }).toFile(fp);
    cleaned++;
    console.log("cleaned", f);
}
console.log(`\n${cleaned} cleaned, ${skipped} already-transparent (of ${files.length}).`);
