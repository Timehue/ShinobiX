// ─────────────────────────────────────────────────────────────────────────────
// pose-cleanup.mjs — one-off ASSET tooling (NOT game code) to clean up the pet
// pose flipbook in public/pet-poses/. It NEVER touches the renderer or any game
// logic — it only reprocesses the static .webp cutouts so they read cleaner and
// stop pulsing in size during battle.
//
// Three modes:
//   --analyze              → asset-gen-out/pose-analysis.json : per-frame connected-
//                            component + alpha-bbox metrics. Finds disconnected
//                            "stray limb" fragments objectively (no vision needed).
//   --montage [--ids a,b]  → asset-gen-out/pose-audit/<id>.png : a per-pet contact
//                            sheet that GROUNDS every frame exactly the way the
//                            coliseum renderer does (groundedSpriteLayout) on a
//                            grey checkerboard, so the in-game size-pulse + any
//                            fringe/strays are visible at a glance.
//   --apply --plan p.json  → reprocess frames per the audit plan, with a backup of
//                            the originals to asset-gen-out/pose-backup/ first.
//
// Run from shinobij.client/:  node scripts/pose-cleanup.mjs --analyze --montage
// ─────────────────────────────────────────────────────────────────────────────
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

// libvips keeps input files mmap'd in its operation cache; on Windows that makes
// a later open of a just-written file fail ("UNKNOWN open"). Disable the cache so
// each read/write fully releases its handle. (One-off tooling; perf is irrelevant.)
sharp.cache(false);

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLIENT = path.resolve(HERE, '..');
const POSE_DIR = path.join(CLIENT, 'public', 'pet-poses');
const OUT_DIR = path.join(CLIENT, 'asset-gen-out');
const AUDIT_DIR = path.join(OUT_DIR, 'pose-audit');
const BACKUP_DIR = path.join(OUT_DIR, 'pose-backup');

const CATS = ['idle', 'attack', 'hurt', 'cast', 'windup', 'lunge', 'impact', 'recover', 'run-a', 'run-b'];
const ALPHA_T = 24;          // alpha above this counts as opaque (matches slicer)

const arg = (n, d = null) => { const i = process.argv.indexOf('--' + n); return i >= 0 ? (process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : true) : d; };
const has = (n) => process.argv.includes('--' + n);

/** All distinct pet ids present in public/pet-poses (idle is the canonical flag). */
function allPetIds() {
    const ids = new Set();
    for (const f of fs.readdirSync(POSE_DIR)) {
        const m = f.match(/^(.+)-idle\.webp$/);
        if (m) ids.add(m[1]);
    }
    return [...ids].sort();
}

/** Load a frame as downscaled raw RGBA for analysis (fractions are scale-free). */
async function loadRaw(file, maxSide = 192) {
    const img = sharp(file).ensureAlpha();
    const meta = await img.metadata();
    const scale = Math.min(1, maxSide / Math.max(meta.width, meta.height));
    const w = Math.max(8, Math.round(meta.width * scale));
    const h = Math.max(8, Math.round(meta.height * scale));
    const { data } = await sharp(file).ensureAlpha().resize(w, h, { fit: 'fill' }).raw().toBuffer({ resolveWithObject: true });
    return { data, w, h, fullW: meta.width, fullH: meta.height };
}

// ── Connected-component labelling (8-connectivity) over the alpha mask ─────────
function components(data, w, h) {
    const label = new Int32Array(w * h).fill(0);
    const comps = [];
    const stack = [];
    let next = 0;
    const opaque = (i) => data[i * 4 + 3] > ALPHA_T;
    for (let p = 0; p < w * h; p++) {
        if (!opaque(p) || label[p]) continue;
        next++;
        let area = 0, sumX = 0, sumY = 0, minX = w, minY = h, maxX = -1, maxY = -1;
        let sumR = 0, sumG = 0, sumB = 0;
        stack.push(p);
        label[p] = next;
        while (stack.length) {
            const q = stack.pop();
            const x = q % w, y = (q / w) | 0;
            area++; sumX += x; sumY += y;
            if (x < minX) minX = x; if (x > maxX) maxX = x;
            if (y < minY) minY = y; if (y > maxY) maxY = y;
            sumR += data[q * 4]; sumG += data[q * 4 + 1]; sumB += data[q * 4 + 2];
            for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
                if (!dx && !dy) continue;
                const nx = x + dx, ny = y + dy;
                if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
                const nq = ny * w + nx;
                if (!label[nq] && opaque(nq)) { label[nq] = next; stack.push(nq); }
            }
        }
        const r = sumR / area, g = sumG / area, b = sumB / area;
        const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
        const sat = mx <= 0 ? 0 : (mx - mn) / mx;
        comps.push({ id: next, area, cx: sumX / area, cy: sumY / area, minX, minY, maxX, maxY, r, g, b, sat });
    }
    comps.sort((a, b) => b.area - a.area);
    return { comps, label };
}

/** Gap (in px, on the downscaled grid) between two axis-aligned bboxes; 0 if they overlap. */
function bboxGap(a, b) {
    const dx = Math.max(0, Math.max(a.minX - b.maxX, b.minX - a.maxX));
    const dy = Math.max(0, Math.max(a.minY - b.maxY, b.minY - a.maxY));
    return Math.hypot(dx, dy);
}

async function analyzeFrame(file) {
    const { data, w, h } = await loadRaw(file);
    const { comps } = components(data, w, h);
    if (!comps.length) return { empty: true };
    const main = comps[0];
    const diag = Math.hypot(w, h);
    // Content bbox over ALL opaque pixels vs MAIN component only — a big difference
    // means a stray fragment is inflating the bounding box (which the renderer
    // normalizes by, shrinking the body → the "small/big" pulse).
    let aMinX = w, aMinY = h, aMaxX = -1, aMaxY = -1;
    for (const c of comps) { aMinX = Math.min(aMinX, c.minX); aMinY = Math.min(aMinY, c.minY); aMaxX = Math.max(aMaxX, c.maxX); aMaxY = Math.max(aMaxY, c.maxY); }
    const allFracH = (aMaxY - aMinY + 1) / h;
    const mainFracH = (main.maxY - main.minY + 1) / h;
    const mainFracW = (main.maxX - main.minX + 1) / w;
    const strays = [];
    for (const c of comps.slice(1)) {
        const areaFrac = c.area / main.area;
        if (areaFrac < 0.0008) continue;                 // ignore dust specks (re-key removes them)
        const gap = bboxGap(c, main) / diag;             // gap as fraction of the diagonal
        const nearEdge = Math.min(c.minX, c.minY, w - 1 - c.maxX, h - 1 - c.maxY) / Math.min(w, h) < 0.06;
        // Heuristic "this looks like a body part, not an effect": brownish/grey/low-sat
        // OR generally desaturated. Effects (fire/energy) are high-sat + bright.
        const looksFur = c.sat < 0.45;
        strays.push({
            areaFrac: +areaFrac.toFixed(4), gap: +gap.toFixed(3), nearEdge,
            sat: +c.sat.toFixed(2), looksFur,
            side: c.cx < w * 0.4 ? 'left' : c.cx > w * 0.6 ? 'right' : 'center',
            vert: c.cy < h * 0.4 ? 'top' : c.cy > h * 0.6 ? 'bottom' : 'mid',
            // strong suspicion = a sizable, separated, fur-toned island near an edge
            suspect: areaFrac > 0.01 && gap > 0.02 && looksFur,
        });
    }
    strays.sort((a, b) => b.areaFrac - a.areaFrac);
    return {
        comps: comps.length,
        mainAreaFrac: +(main.area / (w * h)).toFixed(3),
        mainFracH: +mainFracH.toFixed(3), mainFracW: +mainFracW.toFixed(3),
        bboxInflate: +(allFracH / mainFracH).toFixed(3),  // >1.08 ⇒ stray inflates the height bbox
        strays,
    };
}

async function runAnalyze(ids) {
    const out = {};
    for (const id of ids) {
        out[id] = {};
        for (const cat of CATS) {
            const file = path.join(POSE_DIR, `${id}-${cat}.webp`);
            if (!fs.existsSync(file)) { out[id][cat] = { missing: true }; continue; }
            try { out[id][cat] = await analyzeFrame(file); }
            catch (e) { out[id][cat] = { error: String(e && e.message || e) }; }
        }
    }
    fs.mkdirSync(OUT_DIR, { recursive: true });
    const dest = path.join(OUT_DIR, 'pose-analysis.json');
    fs.writeFileSync(dest, JSON.stringify(out, null, 1));
    // Console summary: pets with the most/biggest suspected strays + bbox inflation.
    const rows = [];
    for (const id of ids) for (const cat of CATS) {
        const a = out[id]?.[cat];
        if (!a || a.missing || a.empty) continue;
        const sus = (a.strays || []).filter((s) => s.suspect);
        if (sus.length || a.bboxInflate > 1.10) rows.push({ id, cat, inflate: a.bboxInflate, sus: sus.length, top: a.strays?.[0]?.areaFrac || 0 });
    }
    rows.sort((x, y) => (y.inflate - x.inflate) || (y.top - x.top));
    console.log(`analyze: ${ids.length} pets → ${dest}`);
    console.log(`flagged ${rows.length} frames (stray suspect or bbox-inflate>1.10). Top 25:`);
    for (const r of rows.slice(0, 25)) console.log(`  ${r.id}-${r.cat}  inflate=${r.inflate}  suspectStrays=${r.sus}  topStrayArea=${r.top}`);
    return out;
}

// ── Montage: ground every frame the way the renderer does, on a grey board ─────
const CELL = 300, COLS = 5, PAD = 8, LABEL_H = 18;
// Mirror groundedSpriteLayout: content bbox → fixed on-screen height, feet on a
// baseline. This reproduces the in-game scale so the size-pulse is visible.
const CONTENT_H = CELL * 0.62;     // target visible content height inside the cell
const BASELINE = CELL - 14;        // feet sit here

async function contentBox(file) {
    const { data, w, h } = await loadRaw(file, 256);
    let minX = w, minY = h, maxX = -1, maxY = -1;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        if (data[(y * w + x) * 4 + 3] > ALPHA_T) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
    }
    if (maxX < 0) return null;
    return { left: minX / w, right: (maxX + 1) / w, top: minY / h, bottom: (maxY + 1) / h };
}

function greyBoard(w, h) {
    // 16px checkerboard so transparency, white fringe AND dark boxing all show.
    const S = 16; const buf = Buffer.alloc(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const c = (((x / S) | 0) + ((y / S) | 0)) % 2 ? 96 : 120;
        const i = (y * w + x) * 4; buf[i] = c; buf[i + 1] = c; buf[i + 2] = c; buf[i + 3] = 255;
    }
    return sharp(buf, { raw: { width: w, height: h, channels: 4 } });
}

async function montageFor(id, srcDir = POSE_DIR, outDir = AUDIT_DIR) {
    const rows = Math.ceil(CATS.length / COLS);
    const W = COLS * CELL + (COLS + 1) * PAD;
    const H = rows * (CELL + LABEL_H) + (rows + 1) * PAD;
    const composites = [];
    for (let i = 0; i < CATS.length; i++) {
        const cat = CATS[i];
        const file = path.join(srcDir, `${id}-${cat}.webp`);
        const col = i % COLS, row = (i / COLS) | 0;
        const cx = PAD + col * (CELL + PAD);
        const cy = PAD + row * (CELL + LABEL_H + PAD);
        // Per-cell grey tile with a baseline rule + label bar.
        const tile = greyBoard(CELL, CELL + LABEL_H);
        const labelSvg = Buffer.from(`<svg width="${CELL}" height="${CELL + LABEL_H}"><rect x="0" y="${CELL}" width="${CELL}" height="${LABEL_H}" fill="#1c1c22"/><line x1="6" y1="${BASELINE}" x2="${CELL - 6}" y2="${BASELINE}" stroke="#00e0ff" stroke-width="1" stroke-dasharray="4 4" opacity="0.6"/><text x="6" y="${CELL + 13}" font-family="monospace" font-size="12" fill="#cfd">${cat}</text></svg>`);
        const layers = [{ input: labelSvg, top: 0, left: 0 }];
        if (fs.existsSync(file)) {
            const box = await contentBox(file);
            if (box) {
                const fracH = Math.max(0.05, box.bottom - box.top);
                const meta = await sharp(file).metadata();
                const aspect = meta.width / meta.height;
                // Scale the FULL image so its content height = CONTENT_H (renderer parity).
                const planeH = CONTENT_H / fracH;
                const planeW = planeH * aspect;
                const drawW = Math.max(1, Math.round(planeW)), drawH = Math.max(1, Math.round(planeH));
                const resized = await sharp(file).resize(drawW, drawH, { fit: 'fill' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
                // Place so content bottom sits on BASELINE, centered on content centroid.
                const contentCx = (box.left + box.right) / 2;
                const left = Math.round(CELL / 2 - planeW * contentCx);
                const top = Math.round(BASELINE - planeH * box.bottom);
                // Clip the (possibly larger-than-cell) frame to the CELL image area
                // [0,CELL)×[0,CELL) — sharp.composite rejects oversized overlays.
                const vx0 = Math.max(0, left), vy0 = Math.max(0, top);
                const vx1 = Math.min(CELL, left + drawW), vy1 = Math.min(CELL, top + drawH);
                if (vx1 > vx0 && vy1 > vy0) {
                    const cw = vx1 - vx0, ch = vy1 - vy0;
                    const sx = vx0 - left, sy = vy0 - top;
                    const clip = await sharp(resized.data, { raw: { width: drawW, height: drawH, channels: 4 } })
                        .extract({ left: sx, top: sy, width: cw, height: ch }).png().toBuffer();
                    layers.push({ input: clip, top: vy0, left: vx0 });
                }
            }
        } else {
            layers.push({ input: Buffer.from(`<svg width="${CELL}" height="${CELL}"><text x="50%" y="50%" fill="#f55" font-size="14" text-anchor="middle">MISSING</text></svg>`), top: 0, left: 0 });
        }
        const cell = await tile.composite(layers).png().toBuffer();
        composites.push({ input: cell, top: cy, left: cx });
    }
    fs.mkdirSync(outDir, { recursive: true });
    const titleSvg = Buffer.from(`<svg width="${W}" height="${H}"><text x="8" y="${H - 6}" font-family="monospace" font-size="13" fill="#fff">${id}</text></svg>`);
    await greyBoard(W, H).composite([...composites, { input: titleSvg, top: 0, left: 0 }]).png().toFile(path.join(outDir, `${id}.png`));
}

async function runMontage(ids) {
    // --from-backup montages the ORIGINAL (pre-cleanup) frames into pose-audit-before/
    // for a side-by-side before/after audit; default montages the cleaned public/.
    const fromBackup = has('from-backup');
    const srcDir = fromBackup ? BACKUP_DIR : POSE_DIR;
    const outDir = fromBackup ? path.join(OUT_DIR, 'pose-audit-before') : AUDIT_DIR;
    fs.mkdirSync(outDir, { recursive: true });
    let n = 0;
    for (const id of ids) { await montageFor(id, srcDir, outDir); n++; if (n % 20 === 0) console.log(`  montage ${n}/${ids.length}`); }
    console.log(`montage: ${n} contact sheets → ${path.relative(CLIENT, outDir)}`);
}

// ── APPLY: reprocess a frame in place (fragment removal + fringe + re-trim) ────
// Tunables (all conservative — bias toward keeping real art, never nuking a body).
const FRINGE_ALPHA = 56;     // erode feathered halo pixels at/below this alpha if they touch full transparency
const DUST_FRAC = 0.004;     // detached island < this fraction of the main body = keying noise → drop
const STRAY_MIN = 0.006;     // a fur-toned detached island ≥ this (and ≤ STRAY_MAX) = leftover limb → drop
// Genuine leftover-limb strays are SMALL vs the body (emberlynx paw 0.075, sparrow
// claw ~0.05, guardhound 0.02-0.08 — all <0.10). Anything bigger is almost always a
// real creature part in a SPLIT/dynamic action pose (a detached head, half a body),
// so capping at 0.10 stops the cleanup from eating creature halves (audit found it
// removing 25-61% chunks on split poses) while keeping every validated stray fix.
const STRAY_MAX = 0.10;      // never drop an island bigger than this fraction of the main body (safety)
const STRAY_GAP = 0.020;     // …only if separated from the body by > this fraction of the image diagonal
// EFFECT vs LEFTOVER-LIMB discriminator (measured from real frames): an orange FLAME
// is luma≈155 / sat≈0.72 while a stray tan LEG is luma≈156 / sat≈0.29 — nearly equal
// brightness, so SATURATION is the separator. Keep a detached blob only if it's a
// vivid bright colour (fire/energy) or a near-white glow; everything else (dark or
// muted-mid fur, grey motion bits, near-white bg remnants) is a leftover → drop.
const EFFECT_SAT = 0.45;     // a kept effect must be at least this saturated…
const EFFECT_LUMA = 130;     // …and at least this bright (vivid colour, not muddy fur)
const GLOW_LUMA = 225;       // …OR a near-white glow this bright (kept regardless of sat)
const PAD_FRAC = 0.10;       // transparent margin around the re-trimmed creature

/** Decide, from a detached component's stats, whether it's removable garbage. */
function isStray(c, mainArea) {
    const areaFrac = c.area / mainArea;
    if (areaFrac < DUST_FRAC) return { drop: true, why: 'dust' };
    if (areaFrac > STRAY_MAX) return { drop: false };
    const luma = 0.299 * c.r + 0.587 * c.g + 0.114 * c.b;
    if ((c.sat >= EFFECT_SAT && luma >= EFFECT_LUMA) || luma >= GLOW_LUMA) return { drop: false }; // colored effect / glow → keep
    return { drop: true, why: 'fur-stray' };           // dark or muted island = leftover limb / bg remnant → drop
}

async function applyFrame(id, cat) {
    const file = path.join(POSE_DIR, `${id}-${cat}.webp`);
    if (!fs.existsSync(file)) return { missing: true };
    // Full-res RGBA (single read — reusing one sharp instance for metadata + raw
    // throws "UNKNOWN open" on Windows/libvips, so take width/height from info).
    const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const W = info.width, H = info.height;
    const removed = [];
    let blackKeyed = false;

    // 0a) Cinematic dark/scene BACKGROUND removal — DISABLED (ENABLE_BLACKKEY=false).
    //     A full audit proved flood-removing the baked black/scene backgrounds also EATS
    //     any DESATURATED creature (white polar-bear golem, grey heron/gargoyle, navy/black
    //     wolf, dark lava-beast): their low-saturation body matches the "grey/dark = bg"
    //     test, and the colour guard passed because the creature kept small bright accents
    //     (gems/scarf/fire) while the body was erased — 42 regressions. Flood-fill cannot
    //     tell a desaturated creature from a desaturated background, so the cinematic
    //     black-box frames are left UNTOUCHED here and flagged for regeneration instead.
    const ENABLE_BLACKKEY = false;
    if (ENABLE_BLACKKEY) {
        const savedA = new Uint8Array(W * H);
        for (let p = 0; p < W * H; p++) savedA[p] = data[p * 4 + 3];
        let opaqueBefore = 0, coloredBefore = 0;
        for (let p = 0; p < W * H; p++) {
            if (data[p * 4 + 3] <= 150) continue; opaqueBefore++;
            const r = data[p * 4], g = data[p * 4 + 1], b = data[p * 4 + 2];
            const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
            if (mx > 0 && (mx - mn) / mx >= 0.34) coloredBefore++;
        }
        // clearable: transparent, OR a desaturated dark→mid pixel (black bg / grey speed
        // line / dim scene). Bright (luma≥205) whites and saturated colour are NOT cleared.
        const bgClearable = (i) => {
            const a = data[i + 3];
            if (a < 90) return true;
            const r = data[i], g = data[i + 1], b = data[i + 2];
            const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
            const sat = mx > 0 ? (mx - mn) / mx : 0;
            const luma = 0.299 * r + 0.587 * g + 0.114 * b;
            return sat < 0.30 && luma < 205;
        };
        const seen = new Uint8Array(W * H);
        const stack = [];
        let cleared = 0;
        const push = (x, y) => { if (x < 0 || y < 0 || x >= W || y >= H) return; const p = y * W + x; if (seen[p]) return; seen[p] = 1; if (bgClearable(p * 4)) { if (data[p * 4 + 3] !== 0) { data[p * 4 + 3] = 0; cleared++; } stack.push(p); } };
        for (let x = 0; x < W; x++) { push(x, 0); push(x, H - 1); }
        for (let y = 0; y < H; y++) { push(0, y); push(W - 1, y); }
        while (stack.length) { const p = stack.pop(); const x = p % W, y = (p / W) | 0; push(x + 1, y); push(x - 1, y); push(x, y + 1); push(x, y - 1); }
        // Surviving coloured creature?
        let coloredAfter = 0;
        for (let p = 0; p < W * H; p++) {
            if (data[p * 4 + 3] <= 150) continue;
            const r = data[p * 4], g = data[p * 4 + 1], b = data[p * 4 + 2];
            const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
            if (mx > 0 && (mx - mn) / mx >= 0.34) coloredAfter++;
        }
        const N = W * H;
        // Commit ONLY when a LARGE field was removed (a real bg fills ≥18% of the frame;
        // merely nibbling a creature's dark OUTLINE clears <10%, so it reverts), the
        // creature still has substantial colour, AND we didn't lose much of it (guards
        // against eating a desaturated/dark creature — that reverts and stays a black box).
        const commit = cleared / N > 0.18 && coloredAfter / N > 0.04 && coloredAfter >= coloredBefore * 0.72;
        if (commit) blackKeyed = true;
        else for (let p = 0; p < N; p++) data[p * 4 + 3] = savedA[p];  // revert — wasn't a clean bg
    }

    // 0) Edge-flood background removal — the slicer's de-white left a faint light-grey
    //    HAZE (alpha ~30-50, RGB ~205) on some sheets; it survives both keyers, fills
    //    the frame and inflates the bbox so the creature renders tiny. Flood inward
    //    from the (already-transparent) border, clearing transparent + faint near-grey
    //    pixels, STOPPING at the solid coloured creature. Interior light details aren't
    //    border-connected, so silver armour / white bellies are preserved.
    const clearable = (i) => {
        const a = data[i + 3];
        if (a === 0) return true;
        if (a < 55) return true;                       // transparent margin / very faint AA fringe
        if (a >= 130) return false;                    // SOLID creature pixel — protect white & dark bodies alike
        const r = data[i], g = data[i + 1], b = data[i + 2];
        const mn = Math.min(r, g, b), mx = Math.max(r, g, b);
        const sat = mx > 0 ? (mx - mn) / mx : 0;
        return mn >= 188 && sat <= 0.10;               // SEMI-TRANSPARENT light-grey / near-white bg haze only
    };
    {
        const seen = new Uint8Array(W * H);
        const stack = [];
        const push = (x, y) => { if (x < 0 || y < 0 || x >= W || y >= H) return; const p = y * W + x; if (seen[p]) return; seen[p] = 1; if (clearable(p * 4)) { data[p * 4 + 3] = 0; stack.push(p); } };
        for (let x = 0; x < W; x++) { push(x, 0); push(x, H - 1); }
        for (let y = 0; y < H; y++) { push(0, y); push(W - 1, y); }
        while (stack.length) { const p = stack.pop(); const x = p % W, y = (p / W) | 0; push(x + 1, y); push(x - 1, y); push(x, y + 1); push(x, y - 1); }
    }

    // 1) Fringe erode — strip 1px of faint feather so halos don't show on a bg.
    const toClear = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4, a = data[i + 3];
        if (a === 0 || a > FRINGE_ALPHA) continue;
        // touches a fully-transparent 4-neighbour?
        const t = (y > 0 && data[((y - 1) * W + x) * 4 + 3] === 0) || (y < H - 1 && data[((y + 1) * W + x) * 4 + 3] === 0)
            || (x > 0 && data[(y * W + x - 1) * 4 + 3] === 0) || (x < W - 1 && data[(y * W + x + 1) * 4 + 3] === 0);
        if (t) toClear.push(i);
    }
    for (const i of toClear) data[i + 3] = 0;

    // 2) Connected-component fragment removal (downscaled label map → upscale mask).
    const S = 256;
    const scale = Math.min(1, S / Math.max(W, H));
    const lw = Math.max(8, Math.round(W * scale)), lh = Math.max(8, Math.round(H * scale));
    const small = await sharp(data, { raw: { width: W, height: H, channels: 4 } }).resize(lw, lh, { fit: 'fill' }).raw().toBuffer();
    const { comps, label } = components(small, lw, lh);
    if (comps.length > 1) {
        const main = comps[0];
        const diag = Math.hypot(lw, lh);
        const dropIds = new Set();
        let droppedArea = 0;
        for (const c of comps.slice(1)) {
            const gap = bboxGap(c, main) / diag;
            const verdict = isStray(c, main.area);
            // dust is dropped regardless of gap; a fur-stray must also be separated.
            if (verdict.drop && (verdict.why === 'dust' || gap > STRAY_GAP)) {
                dropIds.add(c.id); droppedArea += c.area;
                if (verdict.why !== 'dust') removed.push({ areaFrac: +(c.area / main.area).toFixed(3), gap: +gap.toFixed(3), sat: +c.sat.toFixed(2), side: c.cx < lw * 0.4 ? 'left' : c.cx > lw * 0.6 ? 'right' : 'center' });
            }
        }
        // Absolute safety: never delete > 40% of all opaque pixels in one frame.
        const totalArea = comps.reduce((s, c) => s + c.area, 0);
        if (droppedArea / totalArea > 0.40) { dropIds.clear(); removed.length = 0; removed.push({ skipped: 'too-much-would-be-removed' }); }
        if (dropIds.size) {
            // Clear every full-res pixel whose downscaled label is a dropped island.
            for (let y = 0; y < H; y++) {
                const ly = Math.min(lh - 1, (y * scale) | 0);
                for (let x = 0; x < W; x++) {
                    const lx = Math.min(lw - 1, (x * scale) | 0);
                    if (dropIds.has(label[ly * lw + lx])) data[(y * W + x) * 4 + 3] = 0;
                }
            }
        }
    }

    // 3) Re-trim to the surviving content, pad to a clean square with uniform margin.
    let minX = W, minY = H, maxX = -1, maxY = -1;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        if (data[(y * W + x) * 4 + 3] > ALPHA_T) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
    }
    if (maxX < 0) return { empty: true };
    const cw = maxX - minX + 1, ch = maxY - minY + 1;
    const cropped = await sharp(data, { raw: { width: W, height: H, channels: 4 } })
        .extract({ left: minX, top: minY, width: cw, height: ch }).png().toBuffer();
    const side = Math.round(Math.max(cw, ch) * (1 + 2 * PAD_FRAC));
    const out = await sharp({ create: { width: side, height: side, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
        .composite([{ input: cropped, gravity: 'center' }])
        .webp({ quality: 90 }).toBuffer();
    fs.writeFileSync(file, out);
    return { W, H, side, removed, trimmed: [cw, ch], blackKeyed };
}

async function runApply(ids) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const report = {};
    let nFrames = 0, nRemoved = 0;
    for (const id of ids) {
        report[id] = {};
        for (const cat of CATS) {
            const file = path.join(POSE_DIR, `${id}-${cat}.webp`);
            if (!fs.existsSync(file)) { report[id][cat] = { missing: true }; continue; }
            // Back up the ORIGINAL once (never overwrite an existing backup).
            const bak = path.join(BACKUP_DIR, `${id}-${cat}.webp`);
            if (!fs.existsSync(bak)) fs.copyFileSync(file, bak);
            try {
                const r = await applyFrame(id, cat);
                report[id][cat] = r;
                nFrames++;
                if (r.removed && r.removed.some((x) => !x.skipped)) nRemoved++;
            } catch (e) { report[id][cat] = { error: String(e && e.message || e) }; }
        }
        if (Object.keys(report).length % 20 === 0) console.log(`  apply ${Object.keys(report).length}/${ids.length}`);
    }
    fs.writeFileSync(path.join(OUT_DIR, 'pose-cleanup-report.json'), JSON.stringify(report, null, 1));
    console.log(`apply: ${nFrames} frames reprocessed, ${nRemoved} had stray fragments removed. Originals backed up to ${path.relative(CLIENT, BACKUP_DIR)}`);
}

/** Restore originals from the backup (undo an apply). */
function runRestore(ids) {
    let n = 0;
    for (const id of ids) for (const cat of CATS) {
        const bak = path.join(BACKUP_DIR, `${id}-${cat}.webp`);
        const dst = path.join(POSE_DIR, `${id}-${cat}.webp`);
        if (fs.existsSync(bak)) { fs.copyFileSync(bak, dst); n++; }
    }
    console.log(`restore: ${n} frames restored from backup`);
}

async function main() {
    let ids = allPetIds();
    const only = arg('ids');
    if (typeof only === 'string') { const want = new Set(only.split(',').map((s) => s.trim())); ids = ids.filter((id) => want.has(id)); }
    console.log(`pose-cleanup: ${ids.length} pets`);
    if (has('restore')) { runRestore(ids); return; }
    if (has('apply')) await runApply(ids);
    if (has('analyze')) await runAnalyze(ids);
    if (has('montage')) await runMontage(ids);
}
main().catch((e) => { console.error(e); process.exit(1); });
