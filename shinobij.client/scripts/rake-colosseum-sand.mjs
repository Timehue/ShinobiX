// Rakes the Grand Colosseum's arena floor, and touches nothing else.
//
//   node scripts/rake-colosseum-sand.mjs [--check] [--report]
//
// The acceptance queue's live complaint about the bowl is that it "leaves the
// sand as an undifferentiated disk". A rebuild was tried and abandoned: it lost
// the depth, banners and lighting that make the shipped asset good. This is the
// surgical version -- concentric rake lines and a centre medallion composited
// ONLY over the arena floor, with the stands, roof, gates and lanterns
// untouched, because the floor is the one thing actually being complained about.
//
// The sand region is found by flood fill from the centre rather than by a
// hand-typed circle, so the mask follows the painted arena instead of a guess.
import sharp from "sharp";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const source = resolve("src/assets/first-pact/sunken-court-colosseum.webp");
const target = resolve("src/assets/first-pact/gateworks-v2/colosseum-raked.webp");
const check = process.argv.includes("--check");
const report = process.argv.includes("--report");

const base = sharp(source);
const meta = await base.metadata();
const { data, info } = await base.clone().ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const W = info.width, H = info.height, C = info.channels;
const at = (x, y) => (y * W + x) * C;

// Seed on the exact centre and grow across pixels of a similar colour. The sand
// is a broad, flat, warm field; the tiers that surround it are darker and
// greyer, so a modest tolerance stops at the kerb on its own.
const sx = Math.floor(W / 2), sy = Math.floor(H / 2);
const seed = [data[at(sx, sy)], data[at(sx, sy) + 1], data[at(sx, sy) + 2]];
const TOL = 150;
const mask = new Uint8Array(W * H);
const stack = [[sx, sy]];
mask[sy * W + sx] = 1;
let filled = 0;
while (stack.length) {
    const [x, y] = stack.pop();
    filled++;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        if (mask[ny * W + nx]) continue;
        const o = at(nx, ny);
        if (data[o + 3] < 128) continue;
        const d = Math.abs(data[o] - seed[0]) + Math.abs(data[o + 1] - seed[1]) + Math.abs(data[o + 2] - seed[2]);
        if (d > TOL) continue;
        mask[ny * W + nx] = 1;
        stack.push([nx, ny]);
    }
}

let minX = W, maxX = -1, minY = H, maxY = -1;
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (mask[y * W + x]) {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
}
const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
const radius = Math.min(maxX - minX, maxY - minY) / 2;
if (report) {
    console.log(`arena floor: ${filled} px, bounds ${minX}..${maxX} x ${minY}..${maxY}`);
    console.log(`centre (${cx.toFixed(0)},${cy.toFixed(0)}) radius ~${radius.toFixed(0)} of a ${W}x${H} asset`);
    console.log(`floor covers ${((filled / (W * H)) * 100).toFixed(1)}% of the image`);
}
if (filled < 5000) throw new Error(`arena flood fill found only ${filled}px; the sand mask is wrong, refusing to write`);

// Rake lines: concentric arcs at a slight offset from true centre, the way a
// floor is actually dragged, plus a darker inlaid medallion at the middle.
const rings = [];
for (let r = radius * 0.14; r < radius * 0.99; r += Math.max(8, radius * 0.030)) {
    const jitter = Math.sin(r * 0.7) * radius * 0.012;
    rings.push(`<circle cx="${(cx + jitter).toFixed(1)}" cy="${(cy - jitter * 0.6).toFixed(1)}" r="${r.toFixed(1)}" fill="none" stroke="#000" stroke-opacity="0.17" stroke-width="2.4"/>`);
    rings.push(`<circle cx="${(cx + jitter).toFixed(1)}" cy="${(cy - jitter * 0.6).toFixed(1)}" r="${(r + 2.4).toFixed(1)}" fill="none" stroke="#fff" stroke-opacity="0.09" stroke-width="1.8"/>`);
}
const medallion = [
    `<circle cx="${cx}" cy="${cy}" r="${(radius * 0.17).toFixed(1)}" fill="#000" fill-opacity="0.16"/>`,
    `<circle cx="${cx}" cy="${cy}" r="${(radius * 0.17).toFixed(1)}" fill="none" stroke="#000" stroke-opacity="0.30" stroke-width="3"/>`,
    `<circle cx="${cx}" cy="${cy}" r="${(radius * 0.10).toFixed(1)}" fill="none" stroke="#000" stroke-opacity="0.22" stroke-width="2"/>`,
    `<circle cx="${cx}" cy="${cy}" r="${(radius * 0.035).toFixed(1)}" fill="#000" fill-opacity="0.22"/>`,
].join("");
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${rings.join("")}${medallion}</svg>`;
const raked = await sharp(Buffer.from(svg)).ensureAlpha().raw().toBuffer();

// Clip every raked pixel to the arena mask. Anything outside it is discarded, so
// the stands, banners, gates and lighting cannot be altered by this pass.
for (let i = 0; i < W * H; i++) if (!mask[i]) raked[i * 4 + 3] = 0;

const encoded = await sharp(data, { raw: { width: W, height: H, channels: C } })
    .composite([{ input: raked, raw: { width: W, height: H, channels: 4 }, blend: "over" }])
    .webp({ quality: 92 })
    .toBuffer();

if (check) {
    const current = await readFile(target);
    if (!current.equals(encoded)) throw new Error("colosseum-raked.webp is stale; run npm run author:first-pact-colosseum-sand.");
} else {
    await writeFile(target, encoded);
    if (report) console.log(`wrote ${target} (${encoded.length} bytes), source untouched`);
}
void meta;
