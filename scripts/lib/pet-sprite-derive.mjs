/*
 * Pure pixel-math helpers for the pet battle-sprite derivation pipeline
 * (scripts/derive-pet-battle-sprites.mjs). Kept dependency-free (no sharp, no
 * fs) so they unit-test in isolation — the sharp I/O lives in the main script.
 *
 * The "depth" here is a cheap PROCEDURAL stand-in (no ML model required) used to
 * slice a flat cutout into a few parallax bands for the CSS 2.5D billboard.
 * A real monocular-depth model (Depth Anything V2) can be dropped in later to
 * replace proceduralDepth() — the band-slicing below consumes any 0..1 depth.
 */

/** Clamp a number into [0, 1]. */
export function clamp01(v) {
    return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * Procedural depth heuristic in [0,1] (1 = nearest the camera) for a pixel at
 * normalized position (nx, ny) — both in [0,1], origin top-left — with relative
 * luminance lum01 in [0,1]. Combines three cheap cues that hold for a typical
 * centered character portrait:
 *   - vertical : lower in frame reads as nearer (the feet face the camera)
 *   - radial   : closer to the horizontal centre reads as the subject (nearer)
 *   - luminance: a brighter, lit subject sits in front of a darker background
 * Weights sum to 1 so the result stays in [0,1].
 */
export function proceduralDepth(nx, ny, lum01) {
    const vertical = clamp01(ny);
    const radial = 1 - Math.min(1, Math.abs(clamp01(nx) - 0.5) * 2);
    const lum = clamp01(lum01);
    return clamp01(0.45 * vertical + 0.30 * radial + 0.25 * lum);
}

/** Rec.601 relative luminance of an 8-bit RGB triple, returned in [0,1]. */
export function luminance01(r, g, b) {
    return clamp01((0.299 * r + 0.587 * g + 0.114 * b) / 255);
}

/**
 * Even upper-bound thresholds for `bands` depth bands. bands=3 → [1/3, 2/3].
 * (The last band runs to 1.0 implicitly.)
 */
export function depthBandThresholds(bands) {
    const out = [];
    for (let i = 1; i < bands; i++) out.push(i / bands);
    return out;
}

/**
 * Which band index [0 .. bands-1] a depth value falls in — 0 = farthest,
 * bands-1 = nearest. Evenly divides [0,1]; depth 1.0 maps to the last band.
 */
export function bandForDepth(depth01, bands) {
    const d = clamp01(depth01);
    const b = Math.floor(d * bands);
    return b >= bands ? bands - 1 : b;
}

/** Human band names for the common 3-band split, far → near. */
export const BAND_NAMES_3 = ["far", "mid", "near"];

/**
 * Squared Euclidean distance between two 8-bit RGB triples, normalized to
 * [0,1] (max distance = 3·255²). Used by the no-dep corner-key matte to decide
 * how "background-like" a pixel is.
 */
export function colorDistance01(r1, g1, b1, r2, g2, b2) {
    const dr = r1 - r2, dg = g1 - g2, db = b1 - b2;
    return clamp01((dr * dr + dg * dg + db * db) / (3 * 255 * 255));
}

/**
 * Alpha (0..255) for the no-dep corner-key matte: a pixel close to the sampled
 * background color fades out; one far from it stays opaque. `near`/`far` are
 * normalized colorDistance01 cutoffs giving a soft feathered edge between them.
 */
export function matteAlpha(dist01, near = 0.0025, far = 0.02) {
    if (dist01 <= near) return 0;
    if (dist01 >= far) return 255;
    return Math.round(((dist01 - near) / (far - near)) * 255);
}

/**
 * Per-layer horizontal sway offsets (px) for frame `f` of `frames`, used to
 * BAKE a looping pseudo-3D turntable sprite sheet from the flat depth layers:
 * the near plane swings the full amplitude, mid ~0.45×, and far the OPPOSITE
 * ~0.3× — the same motion-parallax cue the live CSS billboard uses, frozen into
 * frames. A real pipeline bakes AI-3D animation here instead; the renderer's
 * sprite-sheet playback mode consumes either. Returns floats (caller rounds).
 */
export function sheetFrameOffsets(f, frames, amp = 10) {
    const phase = frames > 0 ? (2 * Math.PI * f) / frames : 0;
    const s = Math.sin(phase);
    return { far: -amp * 0.3 * s, mid: amp * 0.45 * s, near: amp * s };
}
