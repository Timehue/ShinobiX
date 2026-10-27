// Crops and scales the generated Grand Colosseum gate approach.
//
//   node scripts/process-first-pact-colosseum-approach.mjs [--in <png>] [--out <webp>]
//
// The forecourt is trimmed to its alpha bounds and fitted to five tiles wide by
// four deep at twice the 48px tile size, the same 2x density the city cache
// paints the bowl at. Its TOP edge is the gate side; the screen rotates it to
// face each of the bowl's four gates.
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLIENT = path.resolve(HERE, "..");
const arg = (n, d) => { const i = process.argv.indexOf("--" + n); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };

const TILE = 48;
const SCALE = 2;
const WIDTH = 5 * TILE * SCALE;
const HEIGHT = 4 * TILE * SCALE;

const input = path.resolve(arg("in", path.join(CLIENT, "src/assets/first-pact/gateworks-v2/colosseum-approach-source.png")));
const output = path.resolve(arg("out", path.join(CLIENT, "src/assets/first-pact/gateworks-v2/colosseum-approach.webp")));

const trimmed = await sharp(input).ensureAlpha().trim({ threshold: 8 }).toBuffer({ resolveWithObject: true });
console.log(`trimmed ${trimmed.info.width}x${trimmed.info.height} -> ${WIDTH}x${HEIGHT}`);
const info = await sharp(trimmed.data)
    .resize(WIDTH, HEIGHT, { fit: "fill", kernel: "lanczos3" })
    .webp({ quality: 88, alphaQuality: 95, effort: 6 })
    .toFile(output);
console.log(`wrote ${path.relative(CLIENT, output)} ${info.width}x${info.height} ${info.size} bytes`);
