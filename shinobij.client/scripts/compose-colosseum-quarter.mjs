// Composites the Colosseum quarter module into the full bowl.
//
// The wedge is authored with the arena centre at its BOTTOM-RIGHT corner, so the
// four copies are the wedge itself plus 90/180/270 rotations, laid into the four
// quadrants of a square. The seams fall on the radial gate lines.
//
//   node scripts/compose-colosseum-quarter.mjs [--size 1056] [--preview]
import sharp from "sharp";
import { resolve } from "node:path";

const arg = (n, d) => { const i = process.argv.indexOf("--" + n); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const source = resolve("src/assets/first-pact/gateworks-v2/colosseum-quarter-source.png");
const size = Number(arg("size", 1056));          // 22 tiles at 48px
const half = Math.round(size / 2);

// Trim the generator's faint alpha bloom so the wedge's straight edges are the
// real edges; otherwise the four copies meet on a soft halo instead of stone.
const meta = await sharp(source).metadata();
const alpha = await sharp(source).ensureAlpha().extractChannel(3).raw().toBuffer();
const FLOOR = 128;
let left = meta.width, right = -1, top = meta.height, bottom = -1;
for (let y = 0; y < meta.height; y++) {
    for (let x = 0; x < meta.width; x++) {
        if (alpha[y * meta.width + x] < FLOOR) continue;
        if (x < left) left = x;
        if (x > right) right = x;
        if (y < top) top = y;
        if (y > bottom) bottom = y;
    }
}
console.log(`wedge ink: ${right - left + 1}x${bottom - top + 1} at (${left},${top}) of ${meta.width}x${meta.height}`);
// Crop to the real wedge, then square it so the inner corner lands exactly on
// the composite centre. Any transparent margin left on a straight edge becomes a
// visible seam once four copies meet.
const wedge = await sharp(source)
    .extract({ left, top, width: right - left + 1, height: bottom - top + 1 })
    .resize(half, half, { fit: "fill" })
    .ensureAlpha()
    .toBuffer();

// The generator does not reliably put the arena corner where the prompt asks;
// it flipped between runs. So DETECT it: the arena is pale raked sand, far the
// warmest and brightest region in an otherwise grey-and-indigo wedge. Whichever
// corner is sandiest becomes bottom-right before compositing, which makes the
// pipeline survive any future regeneration.
const probe = await sharp(wedge).raw().toBuffer({ resolveWithObject: true });
const { data: px, info: pi } = probe;
const sandiness = (x0, y0) => {
    let score = 0, n = 0;
    const w = Math.floor(pi.width / 3), h = Math.floor(pi.height / 3);
    for (let y = y0; y < y0 + h; y++) {
        for (let x = x0; x < x0 + w; x++) {
            const o = (y * pi.width + x) * pi.channels;
            if (px[o + 3] < 128) continue;
            const r = px[o], g = px[o + 1], b = px[o + 2];
            // tan: bright, red >= green > blue by a clear margin
            if (r > 140 && r >= g && g > b + 25) score++;
            n++;
        }
    }
    return n ? score / n : 0;
};
const corners = [
    { name: "top-left", x: 0, y: 0, spin: 180 },
    { name: "top-right", x: pi.width - Math.floor(pi.width / 3), y: 0, spin: 90 },
    { name: "bottom-left", x: 0, y: pi.height - Math.floor(pi.height / 3), spin: 270 },
    { name: "bottom-right", x: pi.width - Math.floor(pi.width / 3), y: pi.height - Math.floor(pi.height / 3), spin: 0 },
].map((c) => ({ ...c, score: sandiness(c.x, c.y) }));
corners.sort((a, b) => b.score - a.score);
console.log("arena corner detected:", corners[0].name, corners.map((c) => `${c.name}=${c.score.toFixed(2)}`).join(" "));
const spin = corners[0].spin;

const quadrants = [
    { rotate: 0, left: 0, top: 0 },        // centre corner at bottom-right -> top-left quadrant
    { rotate: 90, left: half, top: 0 },    // centre corner now bottom-left -> top-right quadrant
    { rotate: 180, left: half, top: half },
    { rotate: 270, left: 0, top: half },
];

const layers = [];
for (const q of quadrants) {
    const rotated = await sharp(wedge).rotate((spin + q.rotate) % 360, { background: { r: 0, g: 0, b: 0, alpha: 0 } }).toBuffer();
    layers.push({ input: rotated, left: q.left, top: q.top });
}

const out = resolve(arg("out", "src/assets/first-pact/gateworks-v2/colosseum-v2.png"));
await sharp({ create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite(layers)
    .png({ compressionLevel: 9 })
    .toFile(out);
console.log(`composed ${size}x${size} from four ${half}x${half} quarters -> ${out}`);
