import { test } from "node:test";
import assert from "node:assert/strict";
import {
    clamp01, proceduralDepth, luminance01, depthBandThresholds,
    bandForDepth, colorDistance01, matteAlpha, sheetFrameOffsets,
} from "./lib/pet-sprite-derive.mjs";

test("clamp01 bounds to [0,1]", () => {
    assert.equal(clamp01(-1), 0);
    assert.equal(clamp01(2), 1);
    assert.equal(clamp01(0.5), 0.5);
});

test("proceduralDepth: bottom-centre-bright is NEARER than top-edge-dark", () => {
    const near = proceduralDepth(0.5, 1.0, 1.0);   // bottom centre, lit
    const far = proceduralDepth(0.02, 0.0, 0.0);   // top edge, dark
    assert.ok(near > far);
    assert.ok(near <= 1 && far >= 0);
});

test("proceduralDepth stays within [0,1] for extreme inputs", () => {
    assert.ok(proceduralDepth(-5, 9, 9) <= 1);
    assert.ok(proceduralDepth(-5, -9, -9) >= 0);
});

test("luminance01: white=1, black=0, green brighter than blue", () => {
    assert.equal(luminance01(255, 255, 255), 1);
    assert.equal(luminance01(0, 0, 0), 0);
    assert.ok(luminance01(0, 255, 0) > luminance01(0, 0, 255));
});

test("depthBandThresholds splits evenly", () => {
    assert.deepEqual(depthBandThresholds(1), []);
    assert.deepEqual(depthBandThresholds(2), [0.5]);
    assert.deepEqual(depthBandThresholds(3), [1 / 3, 2 / 3]);
});

test("bandForDepth maps 0→far, 1→near, mids in between", () => {
    assert.equal(bandForDepth(0, 3), 0);
    assert.equal(bandForDepth(0.5, 3), 1);
    assert.equal(bandForDepth(0.99, 3), 2);
    assert.equal(bandForDepth(1, 3), 2);      // clamp: 1.0 → last band, not out of range
    assert.equal(bandForDepth(-0.5, 3), 0);
});

test("colorDistance01: identical=0, black↔white=1", () => {
    assert.equal(colorDistance01(10, 20, 30, 10, 20, 30), 0);
    assert.equal(colorDistance01(0, 0, 0, 255, 255, 255), 1);
});

test("matteAlpha feathers: background→0, subject→255, middle ramps", () => {
    assert.equal(matteAlpha(0), 0);
    assert.equal(matteAlpha(1), 255);
    const mid = matteAlpha(0.011, 0.0025, 0.02);
    assert.ok(mid > 0 && mid < 255);
});

test("sheetFrameOffsets: frame 0 is neutral; quarter swing peaks near>mid>0>far", () => {
    const zero = sheetFrameOffsets(0, 8, 10);
    assert.ok(Math.abs(zero.near) < 1e-9 && Math.abs(zero.mid) < 1e-9 && Math.abs(zero.far) < 1e-9);
    const peak = sheetFrameOffsets(2, 8, 10);   // f=frames/4 → sin=1
    assert.ok(peak.near > peak.mid && peak.mid > 0);
    assert.ok(peak.far < 0);                     // far swings the OPPOSITE way
    assert.ok(Math.abs(peak.near) > Math.abs(peak.far));
});

test("sheetFrameOffsets loops: frame `frames` equals frame 0", () => {
    const a = sheetFrameOffsets(0, 8, 10);
    const b = sheetFrameOffsets(8, 8, 10);
    assert.ok(Math.abs(a.near - b.near) < 1e-9 && Math.abs(a.far - b.far) < 1e-9);
});
