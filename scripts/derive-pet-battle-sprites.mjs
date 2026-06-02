/*
 * Derive 2.5D battle sprites from flat pet portraits.
 *
 * Phase B asset pipeline for the pet-battle visual overhaul. For each input
 * portrait it emits, pixel-aligned on a square, ground-anchored canvas:
 *   <name>-body.png            — a background-removed, trimmed cutout
 *                                (→ the renderer's `petbody:<id>` / full-body
 *                                   standee mode, which already exists)
 *   <name>-far/-mid/-near.png  — depth-sliced parallax layers
 *                                (→ the renderer's `petlayers:<id>:{far,mid,near}`
 *                                   layered-parallax billboard mode)
 *   <name>-sheet.png           — a looping pseudo-3D sprite STRIP (with --sheet N)
 *                                (→ the renderer's `petsheet:<id>` frame-animation
 *                                   mode — the slot a real AI-3D-baked animation
 *                                   sheet drops into for flagship pets)
 *   <name>-depth.png           — the depth map (with --depth; debug / future use)
 *
 * Runs with ZERO new dependencies: it uses `sharp` (already a devDependency)
 * plus a no-ML CUTOUT (corner-colour key + feather) and a PROCEDURAL DEPTH
 * heuristic. Both are deliberately simple stand-ins so the whole chain runs and
 * is verifiable today; swap in production-grade models when ready:
 *   • Cutout : `@imgly/background-removal-node`, or shell out to `rembg`.
 *   • Depth  : Depth Anything V2 (onnx / transformers.js) → a real depth map,
 *              fed straight into the same band-slicer below.
 *
 * Usage:
 *   node scripts/derive-pet-battle-sprites.mjs --in <file|dir> --out <dir> [opts]
 * Options:
 *   --in <path>     source PNG/JPG file, or a directory of them (required)
 *   --out <dir>     output directory (required)
 *   --size <px>     square output size (default 512)
 *   --bands <n>     parallax layer count (default 3 → far/mid/near)
 *   --matte <mode>  cutout mode: "key" (corner-colour key, default) | "none"
 *   --no-layers     emit only the -body cutout, skip the parallax layers
 *   --depth         also write the -depth.png map
 *
 * This is an OFFLINE/admin tool. It never runs in the battle path, touches no
 * storage, and changes no game balance — it only produces image assets that the
 * client looks up by the existing petbody:/petlayers: shared-image keys.
 */

import sharp from "sharp";
import { mkdir, readdir, stat } from "node:fs/promises";
import path from "node:path";
import {
    proceduralDepth, luminance01, bandForDepth, BAND_NAMES_3,
    colorDistance01, matteAlpha, sheetFrameOffsets,
} from "./lib/pet-sprite-derive.mjs";

// ── arg parsing ──────────────────────────────────────────────────────────────
function parseArgs(argv) {
    const a = { size: 512, bands: 3, matte: "key", layers: true, depth: false, sheet: 0, in: null, out: null };
    for (let i = 0; i < argv.length; i++) {
        const k = argv[i];
        if (k === "--in") a.in = argv[++i];
        else if (k === "--out") a.out = argv[++i];
        else if (k === "--size") a.size = Math.max(64, Number(argv[++i]) || 512);
        else if (k === "--bands") a.bands = Math.max(1, Math.min(5, Number(argv[++i]) || 3));
        else if (k === "--matte") a.matte = argv[++i] === "none" ? "none" : "key";
        else if (k === "--no-layers") a.layers = false;
        else if (k === "--depth") a.depth = true;
        else if (k === "--sheet") a.sheet = Math.max(0, Math.min(24, Number(argv[++i]) || 0));
    }
    return a;
}

function bandName(k, bands) {
    return bands === 3 ? BAND_NAMES_3[k] : `layer${k}`;
}

// Average the four corners (a small patch each) into one background colour.
function sampleCornerColor(data, w, h) {
    const patch = Math.max(2, Math.round(Math.min(w, h) * 0.04));
    let r = 0, g = 0, b = 0, n = 0;
    const add = (x, y) => { const i = (y * w + x) * 4; r += data[i]; g += data[i + 1]; b += data[i + 2]; n++; };
    for (let y = 0; y < patch; y++) for (let x = 0; x < patch; x++) {
        add(x, y); add(w - 1 - x, y); add(x, h - 1 - y); add(w - 1 - x, h - 1 - y);
    }
    return { r: r / n, g: g / n, b: b / n };
}

// Remove the background by colour-keying against the sampled corner colour,
// multiplying into any existing alpha and feathering the edge. Mutates `data`.
function applyCornerKeyMatte(data, w, h) {
    const bg = sampleCornerColor(data, w, h);
    for (let i = 0; i < data.length; i += 4) {
        const dist = colorDistance01(data[i], data[i + 1], data[i + 2], bg.r, bg.g, bg.b);
        const a = matteAlpha(dist);
        data[i + 3] = Math.round((data[i + 3] / 255) * a);
    }
}

// Slice a square RGBA body buffer into `bands` parallax layers by procedural
// depth. Returns an array of RGBA Buffers (far → near), each holding only the
// pixels in its depth band (everything else fully transparent).
function sliceLayers(body, w, h, bands) {
    const layers = Array.from({ length: bands }, () => Buffer.alloc(body.length));
    for (let y = 0; y < h; y++) {
        const ny = h > 1 ? y / (h - 1) : 0;
        for (let x = 0; x < w; x++) {
            const i = (y * w + x) * 4;
            const alpha = body[i + 3];
            if (alpha === 0) continue;  // transparent → in no layer
            const nx = w > 1 ? x / (w - 1) : 0;
            const lum = luminance01(body[i], body[i + 1], body[i + 2]);
            const k = bandForDepth(proceduralDepth(nx, ny, lum), bands);
            const dst = layers[k];
            dst[i] = body[i]; dst[i + 1] = body[i + 1]; dst[i + 2] = body[i + 2]; dst[i + 3] = alpha;
        }
    }
    return layers;
}

// Alpha-composite (src-over) a layer's RGBA pixels, shifted by integer `dx`,
// into a destination RGBA strip at column origin (fx) of a `stripW`-wide canvas.
function compositeLayer(dst, stripW, src, w, h, dx, fx) {
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const a = src[(y * w + x) * 4 + 3];
            if (!a) continue;
            const tx = x + dx;
            if (tx < 0 || tx >= w) continue;
            const di = (y * stripW + (fx + tx)) * 4;
            const si = (y * w + x) * 4;
            const sa = a / 255, ia = 1 - sa;
            dst[di]     = Math.round(src[si]     * sa + dst[di]     * ia);
            dst[di + 1] = Math.round(src[si + 1] * sa + dst[di + 1] * ia);
            dst[di + 2] = Math.round(src[si + 2] * sa + dst[di + 2] * ia);
            dst[di + 3] = Math.min(255, a + Math.round(dst[di + 3] * ia));
        }
    }
}

// Bake the depth layers into a looping horizontal sprite STRIP of `frames`
// frames: each frame composites far→near at the swaying parallax offsets, so a
// flat portrait reads as a slowly-rounding 3D figure. Bands are ordered
// far→near; named offsets used for the canonical 3-band split. Returns a raw
// RGBA buffer of size (frames·w) × h. (A real pipeline bakes AI-3D frames here.)
function bakeSheet(layerBufs, w, h, frames, amp) {
    const stripW = frames * w;
    const strip = Buffer.alloc(stripW * h * 4);
    const names = layerBufs.length === 3 ? BAND_NAMES_3 : null;
    for (let f = 0; f < frames; f++) {
        const off = sheetFrameOffsets(f, frames, amp);
        for (let k = 0; k < layerBufs.length; k++) {
            const dx = Math.round(names ? off[names[k]] : 0);
            compositeLayer(strip, stripW, layerBufs[k], w, h, dx, f * w);
        }
    }
    return { strip, stripW };
}

// A grayscale depth-map buffer (single channel) for debugging / a future shader.
function depthMap(body, w, h) {
    const out = Buffer.alloc(w * h);
    for (let y = 0; y < h; y++) {
        const ny = h > 1 ? y / (h - 1) : 0;
        for (let x = 0; x < w; x++) {
            const i = (y * w + x) * 4;
            if (body[i + 3] === 0) { out[y * w + x] = 0; continue; }
            const nx = w > 1 ? x / (w - 1) : 0;
            const lum = luminance01(body[i], body[i + 1], body[i + 2]);
            out[y * w + x] = Math.round(proceduralDepth(nx, ny, lum) * 255);
        }
    }
    return out;
}

async function deriveOne(inputPath, opts) {
    const base = path.basename(inputPath).replace(/\.[^.]+$/, "");
    const size = opts.size;

    // 1) Fit the portrait into the square, force RGBA, read raw pixels.
    const pre = sharp(inputPath).resize(size, size, { fit: "inside", withoutEnlargement: false }).ensureAlpha();
    const { data, info } = await pre.raw().toBuffer({ resolveWithObject: true });

    // 2) Cutout (background removal).
    if (opts.matte === "key") applyCornerKeyMatte(data, info.width, info.height);

    // 3) Trim transparency, re-anchor to the bottom-centre of a square canvas so
    //    the figure "stands" on the tile floor — the body cutout the standee uses.
    const transparent = { r: 0, g: 0, b: 0, alpha: 0 };
    let bodyPipeline = sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } });
    if (opts.matte === "key") { try { bodyPipeline = bodyPipeline.trim(); } catch { /* nothing to trim */ } }
    const bodyPng = await bodyPipeline
        .resize(size, size, { fit: "contain", position: "south", background: transparent })
        .png()
        .toBuffer();
    await sharp(bodyPng).toFile(path.join(opts.out, `${base}-body.png`));

    const written = [`${base}-body.png`];
    if (!opts.layers && !opts.depth && !opts.sheet) return written;

    // 4) Re-read the final, pixel-aligned body for slicing so the layers and the
    //    body share one coordinate space (parallax stacks line up exactly).
    const { data: body, info: bInfo } = await sharp(bodyPng).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const w = bInfo.width, h = bInfo.height;

    // Layers feed BOTH the parallax mode and the sheet baker, so compute them
    // whenever either is requested.
    const layers = (opts.layers || opts.sheet) ? sliceLayers(body, w, h, opts.bands) : null;

    if (opts.layers && layers) {
        for (let k = 0; k < layers.length; k++) {
            const name = `${base}-${bandName(k, opts.bands)}.png`;
            await sharp(layers[k], { raw: { width: w, height: h, channels: 4 } }).png().toFile(path.join(opts.out, name));
            written.push(name);
        }
    }
    if (opts.sheet && layers) {
        const { strip, stripW } = bakeSheet(layers, w, h, opts.sheet, Math.max(4, Math.round(w * 0.03)));
        await sharp(strip, { raw: { width: stripW, height: h, channels: 4 } }).png().toFile(path.join(opts.out, `${base}-sheet.png`));
        written.push(`${base}-sheet.png (${opts.sheet}f)`);
    }
    if (opts.depth) {
        const name = `${base}-depth.png`;
        await sharp(depthMap(body, w, h), { raw: { width: w, height: h, channels: 1 } }).png().toFile(path.join(opts.out, name));
        written.push(name);
    }
    return written;
}

async function listInputs(inPath) {
    const s = await stat(inPath);
    if (s.isFile()) return [inPath];
    const entries = await readdir(inPath);
    return entries.filter((f) => /\.(png|jpe?g|webp)$/i.test(f)).map((f) => path.join(inPath, f));
}

async function main() {
    const opts = parseArgs(process.argv.slice(2));
    if (!opts.in || !opts.out) {
        console.error("Usage: node scripts/derive-pet-battle-sprites.mjs --in <file|dir> --out <dir> [--size 512] [--bands 3] [--matte key|none] [--no-layers] [--depth] [--sheet <frames>]");
        process.exit(2);
    }
    await mkdir(opts.out, { recursive: true });
    const inputs = await listInputs(opts.in);
    if (inputs.length === 0) { console.error(`No images found at ${opts.in}`); process.exit(1); }

    let ok = 0;
    for (const input of inputs) {
        try {
            const written = await deriveOne(input, opts);
            console.log(`  + ${path.basename(input)} → ${written.join(", ")}`);
            ok++;
        } catch (err) {
            console.error(`  ! ${path.basename(input)} failed: ${err.message}`);
        }
    }
    console.log(`\nDone — derived sprites for ${ok}/${inputs.length} image(s) into ${opts.out}/`);
    console.log("Note: cutout + depth here are no-dep heuristics. For production quality,");
    console.log("re-run with a real matting model (@imgly/background-removal-node / rembg) and");
    console.log("a Depth Anything V2 depth map fed into the same band-slicer.");
}

main().catch((err) => { console.error(err); process.exit(1); });
