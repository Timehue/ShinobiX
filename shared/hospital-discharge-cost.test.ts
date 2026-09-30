import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hospitalDischargeBaseCost } from './hospital-discharge-cost.js';

test('hospital skip cost scales at 25 ryo per level and caps at 2,500', () => {
    for (const [level, expected] of [
        [1, 25],
        [3, 75],
        [50, 1_250],
        [99, 2_475],
        [100, 2_500],
        [101, 2_500],
    ] as const) {
        assert.equal(hospitalDischargeBaseCost(level), expected, `level ${level}`);
    }
});

test('invalid and missing levels use the level-one price floor', () => {
    for (const level of [undefined, null, Number.NaN, 0, -5]) {
        assert.equal(hospitalDischargeBaseCost(level), 25);
    }
});
