import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exceedsRowGrowthCap, jsonLength, ROW_GROWTH_CAPS } from './_row-growth-cap.js';

test('row growth cap: a row under its ceiling is always accepted', () => {
    assert.equal(exceedsRowGrowthCap(null, { a: 'x'.repeat(1000) }, 2048), false);
});

test('row growth cap: growing past the ceiling is refused', () => {
    const prev = { a: 'x'.repeat(1000) };
    const next = { ...prev, junk: 'y'.repeat(5000) };
    assert.equal(exceedsRowGrowthCap(prev, next, 2048), true);
    assert.equal(exceedsRowGrowthCap(null, next, 2048), true, 'a brand-new oversized row is refused too');
});

test('row growth cap: a row already over the ceiling may be saved if it does not grow', () => {
    const prev = { a: 'x'.repeat(5000) };
    assert.equal(exceedsRowGrowthCap(prev, { a: 'x'.repeat(4000) }, 2048), false, 'shrinking is fine');
    assert.equal(exceedsRowGrowthCap(prev, { a: 'z'.repeat(5000) }, 2048), false, 'same size is fine');
    assert.equal(exceedsRowGrowthCap(prev, { a: 'x'.repeat(5001) }, 2048), true);
});

test('row growth cap: ceilings sit far above the largest real rows (2026-11-04)', () => {
    assert.ok(ROW_GROWTH_CAPS.playerSave >= 609_311 * 4);
    assert.ok(ROW_GROWTH_CAPS.clanSave >= 56_441 * 4);
    assert.ok(ROW_GROWTH_CAPS.villageState >= 5_325 * 20);
    assert.equal(jsonLength(undefined), 0);
});
