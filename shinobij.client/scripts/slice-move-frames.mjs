// Slice a Nano-Banana MOVE-SEQUENCE sheet into individual trimmed/centered frames.
// Layout-ROBUST: nano-banana returns the 4 frames as a horizontal row OR a 2x2
// grid, so this detects ROW bands first, then COLUMN segments within each band,
// keeps the N largest cells, and orders them in reading order (top→bottom, left→
// right). Reuses the de-white / edge-bg-removal from slice-pet-poses.
//
//   node scripts/slice-move-frames.mjs --in asset-gen-out/pet-moveframes/<id>-moves.png --out-name <id> --out-dir public/pet-poses
//
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLIENT_ROOT = path.resolve(HERE, '..');
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const POSES = arg('poses', 'windup,lunge,impact,recover').split(',').map((s) => s.trim()).filter(Boolean);
const N = POSES.length;
const ALPHA_T = 24;
const FRAME = 512;

function deWhiteInPlace(data) {
    for (let i = 0; i < data.length; i += 4) {
        const r = data[i], g = data[i + 1], b = data[i + 2];
        const mn = Math.min(r, g, b), mx = Math.max(r, g, b);
        if (mx - mn > 26) continue;
        if (mn >= 222) data[i + 3] = 0;
        else if (mn >= 196) data[i + 3] = Math.round(data[i + 3] * ((222 - mn) / 26));
    }
}
function removeEdgeBg(data, W, H) {
    const ci = 0, cj = (W - 1) * 4, ck = (H - 1) * W * 4;
    const br = (data[ci] + data[cj] + data[ck]) / 3, bg = (data[ci + 1] + data[cj + 1] + data[ck + 1]) / 3, bb = (data[ci + 2] + data[cj + 2] + data[ck + 2]) / 3;
    const tol = 70 * 70;
    const close = (i) => { const dr = data[i] - br, dg = data[i + 1] - bg, db = data[i + 2] - bb; return dr * dr + dg * dg + db * db < tol; };
    const stack = [];
    const visit = (x, y) => { if (x < 0 || y < 0 || x >= W || y >= H) return; const i = (y * W + x) * 4; if (data[i + 3] === 0 || !close(i)) return; data[i + 3] = 0; stack.push(x, y); };
    for (let x = 0; x < W; x++) { visit(x, 0); visit(x, H - 1); }
    for (let y = 0; y < H; y++) { visit(0, y); visit(W - 1, y); }
    while (stack.length) { const y = stack.pop(), x = stack.pop(); visit(x + 1, y); visit(x - 1, y); visit(x, y + 1); visit(x, y - 1); }
}
function segments(occ, gapPx, minLen) {
    const segs = []; let start = -1;
    for (let i = 0; i <= occ.length; i++) {
        if (i < occ.length && occ[i]) { if (start < 0) start = i; }
        else if (start >= 0) { segs.push([start, i - 1]); start = -1; }
    }
    const merged = [];
    for (const s of segs) { const last = merged[merged.length - 1]; if (last && s[0] - last[1] <= gapPx) last[1] = s[1]; else merged.push([...s]); }
    return merged.filter(([a, b]) => b - a + 1 >= (minLen || 0));
}

async function main() {
    const inRel = arg('in'); if (!inRel) { console.error('need --in'); process.exit(1); }
    const inPath = path.isAbsolute(inRel) ? inRel : path.join(CLIENT_ROOT, inRel);
    const outName = arg('out-name', path.basename(inPath).replace(/-moves\.png$/, ''));
    const outDirArg = arg('out-dir');
    const outDir = outDirArg ? (path.isAbsolute(outDirArg) ? outDirArg : path.join(CLIENT_ROOT, outDirArg)) : path.join(CLIENT_ROOT, 'public', 'pet-poses');
    fs.mkdirSync(outDir, { recursive: true });

    const { data, info } = await sharp(inPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const W = info.width, H = info.height;
    if (Math.min(data[0], data[1], data[2]) < 200) removeEdgeBg(data, W, H);
    deWhiteInPlace(data);
    const occAt = (x, y) => data[(y * W + x) * 4 + 3] > ALPHA_T;

    // ROW bands → for each, COLUMN cells → tighten bbox → collect. DENSITY-based
    // occupancy (count opaque pixels per row/column, require a minimum) so thin
    // motion-lines / wisps that bridge the gaps between frames don't merge two
    // creatures into one blob. Column gap-merge bridges intra-creature gaps (legs)
    // but not the wider inter-creature spacing.
    const MIN_ROW = Math.round(0.012 * W);
    const rowOcc = new Array(H);
    for (let y = 0; y < H; y++) { let c = 0; for (let x = 0; x < W; x++) if (occAt(x, y)) c++; rowOcc[y] = c >= MIN_ROW; }
    const rowBands = segments(rowOcc, Math.round(0.04 * H), Math.round(0.06 * H));
    // Even-grid split by detected layout: nano-banana lays the 4 frames as a 1x4
    // ROW (1 row band) or a 2x2 GRID (2 row bands). Split the band's occupied
    // X-range into equal cells; per-cell trim re-centers each creature. (Gap
    // detection is unreliable — the creatures' tails/manes bridge the gaps.)
    const bands = rowBands.length ? rowBands : [[0, H - 1]];
    const perRow = bands.length >= 2 ? 2 : N;            // 2x2 → 2/row; else 1x4
    const cells = [];
    for (const [ry0, ry1] of bands.slice(0, Math.ceil(N / perRow))) {
        let bx0 = W, bx1 = -1;
        for (let x = 0; x < W; x++) { let on = false; for (let y = ry0; y <= ry1; y++) if (occAt(x, y)) { on = true; break; } if (on) { if (x < bx0) bx0 = x; if (x > bx1) bx1 = x; } }
        if (bx1 < bx0) { bx0 = 0; bx1 = W - 1; }
        const span = (bx1 - bx0 + 1) / perRow;
        for (let i = 0; i < perRow; i++) cells.push({ x0: Math.round(bx0 + i * span), x1: Math.round(bx0 + (i + 1) * span) - 1, y0: ry0, y1: ry1 });
    }
    const keep = cells.slice(0, N);
    if (keep.length < N) console.warn(`WARN: only ${keep.length}/${N} cells for ${outName}`);
    console.log(`${outName}: sheet ${W}x${H}, ${bands.length} row band(s) → ${keep.length} cells (even-split)`);

    const mk = (left, top, width, height, doTrim) => {
        let p = sharp(Buffer.from(data), { raw: { width: W, height: H, channels: 4 } }).extract({ left, top, width, height });
        if (doTrim) p = p.trim({ threshold: 10 });
        return p.resize(FRAME, FRAME, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).webp({ quality: 88 }).toBuffer();
    };
    for (let i = 0; i < keep.length; i++) {
        const c = keep[i];
        const left = Math.max(0, Math.min(W - 1, c.x0));
        const top = Math.max(0, Math.min(H - 1, c.y0));
        const width = Math.max(1, Math.min(W - left, c.x1 - c.x0 + 1));
        const height = Math.max(1, Math.min(H - top, c.y1 - c.y0 + 1));
        if (width < 8 || height < 8) { console.warn(`  skip ${POSES[i]} degenerate ${width}x${height}`); continue; }
        let frame;
        try { frame = await mk(left, top, width, height, true); }       // tight trim
        catch { frame = await mk(left, top, width, height, false); }     // empty-ish → skip trim
        fs.writeFileSync(path.join(outDir, `${outName}-${POSES[i]}.webp`), frame);
        console.log(`  ${POSES[i]} [${left},${top} ${width}x${height}] ${(frame.length / 1024).toFixed(0)}KB`);
    }
}
main().catch((e) => { console.error(e); process.exit(1); });
