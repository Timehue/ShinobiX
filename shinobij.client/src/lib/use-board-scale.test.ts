import assert from "node:assert/strict";
import test from "node:test";
import { applyBoardZoomOffset, fitBoardScale } from "./use-board-scale";

test("board fit never exceeds either measured container axis", () => {
    for (const [width, height] of [[512, 160], [800, 182], [320, 90], [1920, 900]]) {
        const scale = fitBoardScale(width, height, 666, 411);
        assert.ok(666 * scale <= width);
        assert.ok(411 * scale <= height);
    }
});

test("manual zoom-out stays visible without exceeding the fitted scale", () => {
    assert.equal(applyBoardZoomOffset(0.3, -0.4), 0.05);
    assert.equal(applyBoardZoomOffset(0.03, -0.4), 0.03);
    assert.equal(applyBoardZoomOffset(0.6, 0), 0.6);
    assert.equal(applyBoardZoomOffset(3, 0), 2.5);
});
