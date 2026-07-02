import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { TRAINING_TIERS, trainingStatGain } from './training-config';

// Pins the two-axis training gains + the ~90-day-to-cap pacing anchor
// (docs/leveling-training-redesign-plan.md). A later rate tweak that would break
// the 90-day target or the gentle cross-tier slope fails here.

const byId: Record<string, (typeof TRAINING_TIERS)[number]> =
    Object.fromEntries(TRAINING_TIERS.map((t) => [t.id, t]));

describe('training tiers — full-session gains (23/22/21/20 per hour → 6/22/84/160)', () => {
    it('matches the calibrated table', () => {
        assert.equal(trainingStatGain(byId['15m'], byId['15m'].ms), 6);   // 23 × 0.25 = 5.75 → 6
        assert.equal(trainingStatGain(byId['1h'], byId['1h'].ms), 22);
        assert.equal(trainingStatGain(byId['4h'], byId['4h'].ms), 84);
        assert.equal(trainingStatGain(byId['8h'], byId['8h'].ms), 160);
    });
    it('is offline-safe: elapsed past the tier duration never over-grants', () => {
        assert.equal(trainingStatGain(byId['8h'], byId['8h'].ms * 5), 160);
    });
    it('prorates linearly within a tier and floors at 0', () => {
        assert.equal(trainingStatGain(byId['8h'], byId['8h'].ms / 2), 80);
        assert.equal(trainingStatGain(byId['1h'], 0), 0);
        assert.equal(trainingStatGain(byId['1h'], -1000), 0);
    });
    it('applies the village training bonus multiplicatively', () => {
        assert.equal(trainingStatGain(byId['8h'], byId['8h'].ms, 50), 240); // 160 × 1.5
    });
});

describe('cross-tier slope — close together (~1.15×), shorter tiers slightly better per hour', () => {
    it('per-hour rates are 23/22/21/20, monotonic non-increasing, spread under 1.2×', () => {
        assert.equal(byId['15m'].ratePerHour, 23);
        assert.equal(byId['1h'].ratePerHour, 22);
        assert.equal(byId['4h'].ratePerHour, 21);
        assert.equal(byId['8h'].ratePerHour, 20);
        for (let i = 1; i < TRAINING_TIERS.length; i++) {
            assert.ok(TRAINING_TIERS[i].ratePerHour <= TRAINING_TIERS[i - 1].ratePerHour, 'non-increasing per-hour rate');
        }
        assert.ok(byId['15m'].ratePerHour / byId['8h'].ratePerHour < 1.2, 'spread under 1.2× (not a steep curve)');
    });
});

describe('~90-day-to-cap pacing anchor', () => {
    const FULL_CAP = 12 * (2500 - 10); // 29,880 — every stat to the endgame cap
    it('a dedicated daily player (~16 train-hours/day on the 8h tier) caps in ~90 days', () => {
        const perDay = 16 * byId['8h'].ratePerHour; // 16h × 20/hr = 320/day
        const days = FULL_CAP / perDay;
        assert.ok(days >= 80 && days <= 105, `days-to-full-cap = ${days.toFixed(1)} (target ~90)`);
    });
});
