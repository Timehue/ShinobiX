import assert from 'node:assert/strict';
import { test } from 'node:test';
import { anchorRyoPerMinute, ECONOMY_ANCHOR_CAP } from './economy-anchor.js';

// A(L) = min(300, 20 + 4L): the ryo one active minute is worth at level L
// (2026-10 rebalance). Every re-anchored payout is a multiple of it.

test('the anchor rises 4 ryo a level and plateaus at L70', () => {
    assert.equal(anchorRyoPerMinute(10), 60);
    assert.equal(anchorRyoPerMinute(50), 220);
    assert.equal(anchorRyoPerMinute(70), 300);
    assert.equal(anchorRyoPerMinute(90), 300);
    assert.equal(anchorRyoPerMinute(100), ECONOMY_ANCHOR_CAP);
});

test('a missing, junk or negative level reads as L1', () => {
    assert.equal(anchorRyoPerMinute(undefined as unknown as number), 24);
    assert.equal(anchorRyoPerMinute(Number.NaN), 24);
    assert.equal(anchorRyoPerMinute(-5), 24);
    assert.equal(anchorRyoPerMinute(10.9), 60, 'levels are whole');
});
