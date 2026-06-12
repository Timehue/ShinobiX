// Slice a Nano-Banana pose sheet (4 creatures in a row on transparency) into
// individual trimmed, centered pose frames. Uses gap detection on the alpha
// channel (the poses are NOT in even cells), then trims + pads each to a square.
//
//   node scripts/slice-pet-poses.mjs --in asset-gen-out/pet-anim/kitsune-poses.png --out-name kitsune
//
// Output: src/assets/coliseum/pet-poses/<name>-{idle,attack,hurt,cast}.webp
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLIENT_ROOT = path.resolve(HERE, '..');
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };

const POSES = ['idle', 'attack', 'hurt', 'cast'];
const ALPHA_T = 24;     // a pixel counts as "occupied" above this alpha
const GAP_MIN = 0.018;  // merge segments closer than this fraction of width
const FRAME = 512;      // output square size

// Key out the model's NEAR-WHITE NEUTRAL background → transparent. Only touches
// bright low-saturation pixels (the creatures are dark/saturated, golden auras
// are saturated → preserved). Feathers the anti-aliased edge to avoid a fringe.
function deWhiteInPlace(data) {
    for (let i = 0; i < data.length; i += 4) {
        const r = data[i], g = data[i + 1], b = data[i + 2];
        const mn = Math.min(r, g, b), mx = Math.max(r, g, b);
        if (mx - mn > 26) continue;            // saturated → part of the creature
        if (mn >= 222) data[i + 3] = 0;        // solid white bg → fully transparent
        else if (mn >= 196) data[i + 3] = Math.round(data[i + 3] * ((222 - mn) / 26)); // edge feather
    }
}

async function main() {
    const inRel = arg('in');
    if (!inRel) { console.error('need --in <sheet.png>'); process.exit(1); }
    const inPath = path.isAbsolute(inRel) ? inRel : path.join(CLIENT_ROOT, inRel);
    const outName = arg('out-name', path.basename(inPath).replace(/-poses\.png$/, ''));
    const outDir = path.join(CLIENT_ROOT, 'src', 'assets', 'coliseum', 'pet-poses');
    fs.mkdirSync(outDir, { recursive: true });

    const img = sharp(inPath).ensureAlpha();
    const { width: W, height: H } = await img.metadata();
    const { data } = await img.raw().toBuffer({ resolveWithObject: true }); // RGBA

    // Per-column "occupied" (any opaque pixel).
    const occ = new Array(W).fill(false);
    for (let x = 0; x < W; x++) {
        for (let y = 0; y < H; y++) {
            if (data[(y * W + x) * 4 + 3] > ALPHA_T) { occ[x] = true; break; }
        }
    }
    // Occupied-column runs → segments; merge runs separated by a small gap.
    let segs = [];
    let start = -1;
    for (let x = 0; x <= W; x++) {
        if (x < W && occ[x]) { if (start < 0) start = x; }
        else if (start >= 0) { segs.push([start, x - 1]); start = -1; }
    }
    const gapPx = GAP_MIN * W;
    const merged = [];
    for (const s of segs) {
        const last = merged[merged.length - 1];
        if (last && s[0] - last[1] <= gapPx) last[1] = s[1];
        else merged.push([...s]);
    }
    // Keep the 4 widest segments (drops stray specks), then re-sort left→right.
    merged.sort((a, b) => (b[1] - b[0]) - (a[1] - a[0]));
    let cells = merged.slice(0, 4).sort((a, b) => a[0] - b[0]);
    if (cells.length < 4) {
        console.warn(`only found ${cells.length} segments — falling back to even quarters`);
        cells = [0, 1, 2, 3].map((i) => [Math.floor((i * W) / 4), Math.floor(((i + 1) * W) / 4) - 1]);
    }
    console.log(`sheet ${W}x${H} → ${cells.length} poses at columns ${cells.map((c) => `${c[0]}-${c[1]}`).join(', ')}`);

    for (let i = 0; i < 4; i++) {
        const [x0, x1] = cells[i];
        const w = Math.max(1, x1 - x0 + 1);
        // Extract the cell → strip its white bg → trim to the creature → square.
        const cell = await sharp(inPath).ensureAlpha()
            .extract({ left: x0, top: 0, width: w, height: H })
            .raw().toBuffer({ resolveWithObject: true });
        deWhiteInPlace(cell.data);
        const frame = await sharp(cell.data, { raw: { width: cell.info.width, height: cell.info.height, channels: 4 } })
            .trim({ threshold: 10 })                                   // crop to the creature (bg now transparent)
            .resize(FRAME, FRAME, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
            .webp({ quality: 88 })
            .toBuffer();
        const out = path.join(outDir, `${outName}-${POSES[i]}.webp`);
        fs.writeFileSync(out, frame);
        console.log(`  ${POSES[i]}: ${(frame.length / 1024).toFixed(0)} KB → ${path.relative(CLIENT_ROOT, out)}`);
    }
}
main().catch((e) => { console.error(e); process.exit(1); });
