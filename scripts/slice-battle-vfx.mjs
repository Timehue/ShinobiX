// Slice the CodeManu "Free VFX Asset Pack" Effect_* frame sequences into the
// battle-VFX frame folders the client loads (src/assets/fx/<key>/NNN.png).
// Source: https://codemanu.itch.io/vfx-free-pack (public domain, no attribution
// required). See src/assets/fx/CREDITS.txt for the full per-folder provenance.
//
// Setup:
//   1. The frame sequences are pre-extracted to scripts/vfx-sources/<Effect>/
//      (NNN.png each) — see the unzip step in docs/battle-vfx-overhaul.md.
//   2. node scripts/slice-battle-vfx.mjs
//
// Each output sequence is downsampled to <= MAX_FRAMES evenly-spaced frames and
// fit onto a 64x64 transparent square (matches the existing fx/ frames; the
// renderer is height-driven so per-frame alignment is preserved). Additive
// effects (glow drawn on black) are luminance-keyed to alpha so they render as
// plain transparent <img>s with no blend-mode needed.

import sharp from "sharp";
import { mkdir, readdir, rm } from "node:fs/promises";
import path from "node:path";

// Paths default to repo-relative; override with VFX_SRC / VFX_OUT env vars when
// running from a directory where `sharp` resolves (e.g. a sibling checkout).
const SOURCE_DIR = process.env.VFX_SRC || "scripts/vfx-sources";
const OUTPUT_ROOT = process.env.VFX_OUT || "shinobij.client/src/assets/fx";
const SIZE = 64;
const MAX_FRAMES = 10;

// key -> source effect folder + flags.
//   additive: effect is a glow on a black background -> key black to alpha.
const MANIFEST = [
    { key: "blood",     effect: "Effect_BloodImpact" },
    { key: "shadow",    effect: "Effect_Tentacles" },
    { key: "poison",    effect: "Effect_PuffAndStars" },
    { key: "burn",      effect: "Effect_DitheredFire" },
    { key: "impact",    effect: "Effect_Impact" },
    { key: "spark",     effect: "Effect_SmallHit" },
    { key: "bighit",    effect: "Effect_BigHit" },
    { key: "kaboom",    effect: "Effect_Kabooms" },
    { key: "explosion", effect: "Effect_Explosion2" },
    { key: "magma",     effect: "Effect_Magma" },
    { key: "charge",    effect: "Effect_Charged" },
    { key: "aura",      effect: "Effect_Anima" },
    { key: "eshield",   effect: "Effect_ElectricShield" },
    { key: "vortex",    effect: "Effect_TheVortex",  additive: true },
    { key: "power",     effect: "Effect_PowerChords", additive: true },
];

/** Evenly pick up to MAX_FRAMES indices across [0, len). */
function pickIndices(len) {
    if (len <= MAX_FRAMES) return [...Array(len).keys()];
    const out = [];
    for (let i = 0; i < MAX_FRAMES; i++) {
        out.push(Math.round((i * (len - 1)) / (MAX_FRAMES - 1)));
    }
    return [...new Set(out)];
}

/** Turn a glow-on-black frame into a transparent glow: alpha = max(r,g,b). */
async function luminanceKey(srcPath) {
    const { data, info } = await sharp(srcPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const px = info.width * info.height;
    for (let i = 0; i < px; i++) {
        const o = i * 4;
        const a = Math.max(data[o], data[o + 1], data[o + 2]);
        data[o + 3] = a;
    }
    return sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer();
}

async function buildKey(entry) {
    const srcDir = path.join(SOURCE_DIR, entry.effect);
    let files;
    try {
        files = (await readdir(srcDir)).filter(f => f.toLowerCase().endsWith(".png")).sort();
    } catch {
        console.error(`  ! ${entry.key}: source ${srcDir} missing — skipped`);
        return 0;
    }
    if (!files.length) { console.error(`  ! ${entry.key}: no frames`); return 0; }

    const outDir = path.join(OUTPUT_ROOT, entry.key);
    await rm(outDir, { recursive: true, force: true });
    await mkdir(outDir, { recursive: true });

    const idx = pickIndices(files.length);
    let n = 0;
    for (const i of idx) {
        const srcPath = path.join(srcDir, files[i]);
        const input = entry.additive ? await luminanceKey(srcPath) : srcPath;
        n++;
        await sharp(input)
            .resize(SIZE, SIZE, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
            .png()
            .toFile(path.join(outDir, String(n).padStart(3, "0") + ".png"));
    }
    console.log(`  + ${entry.key}: ${n} frames (${entry.effect}${entry.additive ? ", keyed" : ""})`);
    return n;
}

async function main() {
    let total = 0;
    for (const entry of MANIFEST) total += await buildKey(entry);
    console.log(`\nDone — wrote ${total} frames across ${MANIFEST.length} keys to ${OUTPUT_ROOT}/`);
}

main().catch(err => { console.error(err); process.exit(1); });
