import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { repeatWinDecayMultiplier, REPEAT_WIN_WINDOW_SECONDS } from './_reward-farm.js';

describe('repeatWinDecayMultiplier', () => {
    it('pays the first two wins in full', () => {
        assert.equal(repeatWinDecayMultiplier(0), 1);
        assert.equal(repeatWinDecayMultiplier(1), 1);
    });
    it('tapers after the second win', () => {
        assert.equal(repeatWinDecayMultiplier(2), 0.5);
        assert.equal(repeatWinDecayMultiplier(3), 0.25);
    });
    it('floors at 0.1 for sustained farming', () => {
        assert.equal(repeatWinDecayMultiplier(4), 0.1);
        assert.equal(repeatWinDecayMultiplier(10), 0.1);
        assert.equal(repeatWinDecayMultiplier(1000), 0.1);
    });
    it('never returns a value above 1 or below the floor', () => {
        for (let n = 0; n <= 50; n++) {
            const m = repeatWinDecayMultiplier(n);
            assert.ok(m <= 1, `multiplier ${m} for ${n} exceeds 1`);
            assert.ok(m >= 0.1, `multiplier ${m} for ${n} below floor`);
        }
    });
    it('clamps/floors non-integer and negative inputs defensively', () => {
        assert.equal(repeatWinDecayMultiplier(-5), 1);
        assert.equal(repeatWinDecayMultiplier(2.9), 0.5); // floor(2.9)=2
    });
    it('uses a one-hour farm window', () => {
        assert.equal(REPEAT_WIN_WINDOW_SECONDS, 3600);
    });
});
