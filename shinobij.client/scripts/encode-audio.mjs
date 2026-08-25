/*
 * encode-audio — produce the compressed delivery formats the game actually ships.
 *
 * Two jobs, for two different reasons.
 *
 * 1. SFX + ambience (public/sfx/production/*.wav)
 *    The authored masters are 48 kHz stereo 16-bit WAV. Shipping those costs
 *    ~13.6 MB, and the five ambience beds alone are ~10.2 MB for 10-12 seconds
 *    of looping atmosphere each. This writes two siblings per master:
 *
 *      .ogg (Vorbis q4) — primary. Vorbis is GAPLESS: a decode round-trip of
 *                         ambience-shrine.wav returns a byte-identical PCM
 *                         sample count, so game-audio.ts can keep wrapping the
 *                         beds with `source.loop = true` and hear no seam.
 *      .m4a (AAC 128k)  — for WebKit. AAC adds ~640 samples (~6.7 ms) of decoder
 *                         priming, inaudible at the 0.026-0.055 gains ambience
 *                         plays at and irrelevant for one-shot SFX.
 *
 *    The .wav masters stay in place and stay last in the loader's chain, so a
 *    browser that decodes neither codec is exactly as well off as before.
 *
 * 2. Music (public/music/ ** /*.ogg)
 *    Not a size problem — a SILENCE problem. WebKit (Safari, and every browser
 *    on iOS) decodes no Ogg container at all, verified against a real WebKit
 *    build:
 *      webkit    oggVorbis:(no)  oggOpus:(no)  aac:probably  mp3:probably
 *    So the eight authored .ogg tracks were simply inaudible on iPhone and iPad.
 *    Each gets an .m4a sibling; lib/audio-delivery.ts routes WebKit to it.
 *
 *    These transcode from the .ogg (the only source in the repo), so they are
 *    lossy-over-lossy. 160k AAC sits above the 118-150 kb/s Vorbis sources to
 *    keep generational loss inaudible. Re-encode from the original masters
 *    instead if they ever land in the repo.
 *
 * Usage:  node scripts/encode-audio.mjs [--check]
 *   --check  verify every source has up-to-date siblings; exit 1 if not.
 *
 * Needs ffmpeg. Resolution order: $FFMPEG, then `ffmpeg` on PATH, then the
 * optional `ffmpeg-static` package if one happens to be installed.
 */
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const productionDir = path.join(root, "public", "sfx", "production");
const musicDir = path.join(root, "public", "music");
const check = process.argv.includes("--check");

function resolveFfmpeg() {
    if (process.env.FFMPEG && fs.existsSync(process.env.FFMPEG)) return process.env.FFMPEG;
    try {
        execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
        return "ffmpeg";
    } catch { /* not on PATH */ }
    try {
        return require("ffmpeg-static");
    } catch { /* not installed */ }
    return null;
}

function walk(dir, ext, out = []) {
    if (!fs.existsSync(dir)) return out;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(p, ext, out);
        else if (entry.name.endsWith(ext)) out.push(p);
    }
    return out;
}

const sfxMasters = walk(productionDir, ".wav").sort();
const musicSources = walk(musicDir, ".ogg").sort();

if (sfxMasters.length === 0) {
    console.error(`[encode-audio] no .wav masters in ${productionDir}`);
    process.exit(1);
}

/** Sibling path for a source file, with the extension swapped. */
const sibling = (src, ext) => src.replace(/\.(wav|ogg)$/, ext);

/** A sibling is stale when it is missing or older than the file it derives from. */
function isStale(src, ext) {
    const out = sibling(src, ext);
    if (!fs.existsSync(out)) return true;
    return fs.statSync(out).mtimeMs < fs.statSync(src).mtimeMs;
}

// Music only needs the AAC sibling — the .ogg IS the delivery file everywhere
// that can decode Ogg.
const work = [
    ...sfxMasters.flatMap((src) => [[src, ".ogg"], [src, ".m4a"]]),
    ...musicSources.map((src) => [src, ".m4a"]),
];

if (check) {
    const missing = work.filter(([src, ext]) => isStale(src, ext)).map(([src, ext]) => path.relative(root, sibling(src, ext)));
    if (missing.length) {
        console.error(`[encode-audio] ${missing.length} delivery file(s) missing or stale:`);
        for (const m of missing) console.error(`  ${m}`);
        console.error("[encode-audio] run: node scripts/encode-audio.mjs");
        process.exit(1);
    }
    console.log(`[encode-audio] OK — ${sfxMasters.length} sfx masters and ${musicSources.length} music tracks have current delivery files.`);
    process.exit(0);
}

const ffmpeg = resolveFfmpeg();
if (!ffmpeg) {
    console.error("[encode-audio] ffmpeg not found. Set $FFMPEG, put ffmpeg on PATH, or `npm i -D ffmpeg-static`.");
    process.exit(1);
}

const kb = (n) => `${(n / 1024).toFixed(0)} KB`;
const mb = (n) => `${(n / 1048576).toFixed(2)} MB`;

console.log(`[encode-audio] SFX + ambience (${sfxMasters.length} masters):`);
let masterBytes = 0;
let oggBytes = 0;
let m4aBytes = 0;
for (const src of sfxMasters) {
    const base = path.basename(src, ".wav");
    const ogg = sibling(src, ".ogg");
    const m4a = sibling(src, ".m4a");
    // -q:a 4 is ~128 kbps VBR: transparent for atmospheric beds and short
    // impacts, and Vorbis carries an exact sample count so loops stay gapless.
    execFileSync(ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", "-i", src, "-c:a", "libvorbis", "-q:a", "4", ogg]);
    execFileSync(ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", "-i", src, "-c:a", "aac", "-b:a", "128k", m4a]);
    const mBytes = fs.statSync(src).size;
    const oBytes = fs.statSync(ogg).size;
    const aBytes = fs.statSync(m4a).size;
    masterBytes += mBytes; oggBytes += oBytes; m4aBytes += aBytes;
    console.log(`  ${base.padEnd(22)} ${kb(mBytes).padStart(9)} wav -> ${kb(oBytes).padStart(8)} ogg / ${kb(aBytes).padStart(8)} m4a`);
}

/**
 * Average bitrate of a media file, in kbps. Used to size the AAC sibling to its
 * Vorbis source rather than a flat rate — a fixed 160k made every track LARGER
 * than the .ogg it came from, which would have traded iOS silence for an iOS
 * bandwidth penalty.
 */
function sourceKbps(file) {
    // ffmpeg prints container metadata to stderr and exits non-zero with no
    // output file, which is the documented way to probe without ffprobe.
    let text = "";
    try {
        execFileSync(ffmpeg, ["-hide_banner", "-i", file], { stdio: ["ignore", "ignore", "pipe"] });
    } catch (error) {
        text = String(error.stderr ?? "");
    }
    const m = text.match(/Duration:\s*(\d+):(\d\d):(\d\d(?:\.\d+)?)/);
    if (!m) return null;
    const seconds = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
    if (!seconds) return null;
    return (fs.statSync(file).size * 8) / seconds / 1000;
}

console.log(`[encode-audio] Music AAC siblings for WebKit (${musicSources.length} tracks):`);
let musicSrcBytes = 0;
let musicAacBytes = 0;
for (const src of musicSources) {
    const m4a = sibling(src, ".m4a");
    // Match the source rate (rounded to 8k, clamped to a sane music range) so the
    // sibling lands at roughly the same size. AAC is the more efficient codec, so
    // parity in bitrate means at worst parity in perceived quality.
    const measured = sourceKbps(src);
    const target = measured ? Math.min(176, Math.max(96, Math.round(measured / 8) * 8)) : 144;
    execFileSync(ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", "-i", src, "-c:a", "aac", "-b:a", `${target}k`, m4a]);
    const sBytes = fs.statSync(src).size;
    const aBytes = fs.statSync(m4a).size;
    musicSrcBytes += sBytes; musicAacBytes += aBytes;
    console.log(`  ${path.relative(musicDir, src).padEnd(38)} ${kb(sBytes).padStart(9)} ogg -> ${kb(aBytes).padStart(9)} m4a @${target}k`);
}

console.log(
    `[encode-audio] sfx: ${mb(masterBytes)} wav -> ${mb(oggBytes)} ogg / ${mb(m4aBytes)} m4a `
    + `(${(100 - (oggBytes / masterBytes) * 100).toFixed(1)}% smaller over Vorbis); `
    + `music: ${mb(musicSrcBytes)} ogg + ${mb(musicAacBytes)} m4a for WebKit.`,
);
