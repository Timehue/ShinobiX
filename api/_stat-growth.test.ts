import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import {
    computeCombatStatGrowth, statCapForLevel,
    DAILY_COMBAT_STAT_CAP, COMBAT_USED_STAT_RATIO, STAT_GROWTH_KEYS,
    MAX_AGGREGATE_STAT_BOOST, statGainMultiplier, combinedStatBoost,
} from './_stat-growth.js';

// Pins combat-use stat growth (Stage 4) + the growth-boost dials.
// See docs/leveling-without-xp-map.md §4/§4.1.

const baseStats = () => Object.fromEntries(STAT_GROWTH_KEYS.map((k) => [k, 10])) as Record<string, number>;
const usedTotal = (a: Partial<Record<string, number>>) => Object.values(a).reduce((s: number, n) => s + (n ?? 0), 0);

describe('statCapForLevel — mirrors the canonical per-rank cap table', () => {
    it('bands match 350/700/1300/2100/2500', () => {
        for (const [lvl, cap] of [[1, 350], [14, 350], [15, 700], [29, 700], [30, 1300], [49, 1300], [50, 2100], [79, 2100], [80, 2500], [100, 2500]] as const) {
            assert.equal(statCapForLevel(lvl), cap, `L${lvl}`);
        }
    });
});

describe('computeCombatStatGrowth', () => {
    it('splits ~60/40 used/pool and spends exactly `earned`', () => {
        const g = computeCombatStatGrowth(baseStats(), 100, 8, 999);
        assert.equal(g.spent, 8, 'spent = earned');
        assert.equal(usedTotal(g.allocated), Math.round(8 * COMBAT_USED_STAT_RATIO), 'used share = round(earned·0.6)');
        assert.equal(g.unspentGain, 8 - usedTotal(g.allocated), 'pool = remainder');
    });

    it('is bounded by the remaining daily budget', () => {
        assert.deepEqual(computeCombatStatGrowth(baseStats(), 100, 8, 0), { allocated: {}, unspentGain: 0, spent: 0 }, '0 budget → nothing');
        assert.equal(computeCombatStatGrowth(baseStats(), 100, 8, 3).spent, 3, 'clamped to remaining');
    });

    it('spreads across the invested stats ("how you fight"), not just the top one', () => {
        const stats = { ...baseStats(), strength: 500, speed: 300 };
        const g = computeCombatStatGrowth(stats, 100, 10, 999); // usedShare = round(10·0.6)=6
        assert.equal(usedTotal(g.allocated), 6);
        assert.deepEqual(Object.keys(g.allocated).sort(), ['speed', 'strength'], 'only invested stats grow');
        assert.equal(g.allocated.strength, 3);
        assert.equal(g.allocated.speed, 3);
    });

    it('rolls used-points into the pool when every stat is at its rank cap', () => {
        const capped = Object.fromEntries(STAT_GROWTH_KEYS.map((k) => [k, 350])) as Record<string, number>;
        const g = computeCombatStatGrowth(capped, 1, 10, 999); // level 1 → cap 350, all at cap
        assert.deepEqual(g.allocated, {}, 'no stat can grow');
        assert.equal(g.unspentGain, 10, 'all rolls to the pool');
        assert.equal(g.spent, 10, 'still counts against the daily budget');
    });

    it('never grows a stat past its per-rank cap', () => {
        const stats = { ...baseStats(), strength: 349 }; // 1 below Academy cap 350
        const g = computeCombatStatGrowth(stats, 1, 10, 999);
        assert.ok((g.allocated.strength ?? 0) <= 1, 'strength grows at most to the cap');
    });

    it('the PvP slice is 18/day (3 serious wins — dailies are the bulk of daily growth)', () => {
        assert.equal(DAILY_COMBAT_STAT_CAP, 18);
    });
});

describe('growth boosts (leveling-without-xp map §4.1)', () => {
    it('the era dial defaults to 1 and is aggregate-capped', () => {
        const prev = process.env.STAT_GAIN_MULTIPLIER;
        try {
            delete process.env.STAT_GAIN_MULTIPLIER;
            assert.equal(statGainMultiplier(), 1);
            process.env.STAT_GAIN_MULTIPLIER = '1.5';
            assert.equal(statGainMultiplier(), 1.5);
            process.env.STAT_GAIN_MULTIPLIER = '999';
            assert.equal(statGainMultiplier(), MAX_AGGREGATE_STAT_BOOST, 'runaway env value is capped');
            process.env.STAT_GAIN_MULTIPLIER = 'garbage';
            assert.equal(statGainMultiplier(), 1, 'junk env value falls back to 1');
            process.env.STAT_GAIN_MULTIPLIER = '-2';
            assert.equal(statGainMultiplier(), 1, 'non-positive falls back to 1');
        } finally {
            if (prev === undefined) delete process.env.STAT_GAIN_MULTIPLIER;
            else process.env.STAT_GAIN_MULTIPLIER = prev;
        }
    });
    it('combinedStatBoost folds bonusPct with the era dial under the aggregate ceiling', () => {
        const prev = process.env.STAT_GAIN_MULTIPLIER;
        try {
            delete process.env.STAT_GAIN_MULTIPLIER;
            assert.equal(combinedStatBoost(0), 1);
            assert.equal(combinedStatBoost(25), 1.25);
            assert.equal(combinedStatBoost(-10), 1, 'negative bonus floors at ×1');
            process.env.STAT_GAIN_MULTIPLIER = '2';
            assert.equal(combinedStatBoost(50), MAX_AGGREGATE_STAT_BOOST, '1.5 × 2 = 3 → capped at 2.5');
        } finally {
            if (prev === undefined) delete process.env.STAT_GAIN_MULTIPLIER;
            else process.env.STAT_GAIN_MULTIPLIER = prev;
        }
    });
});
