// pose-despeckle.mjs — remove leftover white/grey KEYING SPECKS from the AI-matted
// and chroma-keyed pose frames (tiny disconnected light low-saturation islands the
// matte/chroma left behind). Conservative: only drops small, LIGHT, desaturated,
// disconnected blobs — never the main body and never a bright SATURATED effect blob.
// Does NOT re-trim/re-pad (preserves framing), and only rewrites frames it changed.
//
//   node scripts/pose-despeckle.mjs            # all pets
//   node scripts/pose-despeckle.mjs --ids a,b  # specific pets
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
sharp.cache(false);

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLIENT = path.resolve(HERE, '..');
const POSE_DIR = path.join(CLIENT, 'public', 'pet-poses');
const CATS = ['idle', 'attack', 'hurt', 'cast', 'windup', 'lunge', 'impact', 'recover', 'run-a', 'run-b'];
const ALPHA_T = 24;
const SPECK_MAX = 0.02;   // a disconnected island ≤ this fraction of the main body is a candidate
const DUST = 0.0008;      // …below this, drop regardless of colour (pure noise)
const SPECK_LUMA = 150;   // a "keying speck" is LIGHT…
const SPECK_SAT = 0.30;   // …and desaturated (white/grey checker remnant), not a colour effect

const arg = (n) => { const i = process.argv.indexOf('--' + n); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : null; };

function components(data, w, h) {
    const label = new Int32Array(w * h); const comps = []; const st = []; let next = 0;
    const op = (i) => data[i * 4 + 3] > ALPHA_T;
    for (let p = 0; p < w * h; p++) {
        if (!op(p) || label[p]) continue; next++;
        let area = 0, sR = 0, sG = 0, sB = 0; st.push(p); label[p] = next;
        while (st.length) {
            const q = st.pop(), x = q % w, y = (q / w) | 0; area++; sR += data[q * 4]; sG += data[q * 4 + 1]; sB += data[q * 4 + 2];
            for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { if (!dx && !dy) continue; const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue; const nq = ny * w + nx; if (!label[nq] && op(nq)) { label[nq] = next; st.push(nq); } }
        }
        const r = sR / area, g = sG / area, b = sB / area, mx = Math.max(r, g, b), mn = Math.min(r, g, b);
        comps.push({ id: next, area, luma: 0.299 * r + 0.587 * g + 0.114 * b, sat: mx ? (mx - mn) / mx : 0 });
    }
    comps.sort((a, b) => b.area - a.area);
    return { comps, label };
}

async function despeckle(file) {
    const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const W = info.width, H = info.height;
    const S = 256, scale = Math.min(1, S / Math.max(W, H));
    const lw = Math.max(8, Math.round(W * scale)), lh = Math.max(8, Math.round(H * scale));
    const small = await sharp(data, { raw: { width: W, height: H, channels: 4 } }).resize(lw, lh, { fit: 'fill' }).raw().toBuffer();
    const { comps, label } = components(small, lw, lh);
    if (comps.length < 2) return 0;
    const main = comps[0];
    const drop = new Set();
    for (const c of comps.slice(1)) {
        const af = c.area / main.area;
        if (af <= DUST) { drop.add(c.id); continue; }                                   // pure noise
        if (af <= SPECK_MAX && c.luma >= SPECK_LUMA && c.sat <= SPECK_SAT) drop.add(c.id); // light grey/white keying speck
    }
    if (!drop.size) return 0;
    let cleared = 0;
    for (let y = 0; y < H; y++) { const ly = Math.min(lh - 1, (y * scale) | 0); for (let x = 0; x < W; x++) { const lx = Math.min(lw - 1, (x * scale) | 0); if (drop.has(label[ly * lw + lx]) && data[(y * W + x) * 4 + 3] !== 0) { data[(y * W + x) * 4 + 3] = 0; cleared++; } } }
    if (!cleared) return 0;
    const out = await sharp(data, { raw: { width: W, height: H, channels: 4 } }).webp({ quality: 90 }).toBuffer();
    fs.writeFileSync(file, out);
    return drop.size;
}

async function main() {
    let ids = [...new Set(fs.readdirSync(POSE_DIR).map((f) => f.replace(/-(idle|attack|hurt|cast|run-a|run-b|windup|lunge|impact|recover)\.webp$/, '')))].sort();
    const only = arg('ids'); if (only) { const w = new Set(only.split(',').map((s) => s.trim())); ids = ids.filter((id) => w.has(id)); }
    let changed = 0, specks = 0;
    for (const id of ids) for (const cat of CATS) {
        const f = path.join(POSE_DIR, `${id}-${cat}.webp`); if (!fs.existsSync(f)) continue;
        try { const n = await despeckle(f); if (n) { changed++; specks += n; } } catch (e) { console.log('ERR', id, cat, String(e.message || e).slice(0, 100)); }
    }
    console.log(`despeckle: removed ${specks} keying specks across ${changed} frames (of ${ids.length} pets)`);
}
main().catch((e) => { console.error(e); process.exit(1); });
