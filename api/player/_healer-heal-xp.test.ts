import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { HEALER_MAX_XP_PER_HEAL, healerBaseHealXp, healerHealXpMult } from './_healer-heal-xp.js';

// Framework 3.12 / #37: heal XP x 2 behind HEALER_HEAL_XP_MULT (kill value 1).
function withDial(value: string | undefined, run: () => void): void {
    const prior = process.env.HEALER_HEAL_XP_MULT;
    if (value === undefined) delete process.env.HEALER_HEAL_XP_MULT; else process.env.HEALER_HEAL_XP_MULT = value;
    try { run(); } finally {
        if (prior === undefined) delete process.env.HEALER_HEAL_XP_MULT; else process.env.HEALER_HEAL_XP_MULT = prior;
    }
}

describe('Healer base heal XP', { concurrency: false }, () => {
    it('doubles the share of HP restored by default, still capped at 100 before the dial', () => withDial(undefined, () => {
        assert.equal(HEALER_MAX_XP_PER_HEAL, 100);
        assert.equal(healerHealXpMult(), 2);
        assert.equal(healerBaseHealXp(0.8), 160, 'an 80%-missing patient paid 80 before the rebalance');
        assert.equal(healerBaseHealXp(1), 200);
        assert.equal(healerBaseHealXp(0.355), 70);
        assert.equal(healerBaseHealXp(0), 0);
        assert.equal(healerBaseHealXp(Number.NaN), 0);
        assert.equal(healerBaseHealXp(7), 200, 'a share above 1 is clamped');
    }));

    it('returns to the pre-rebalance pay at the kill value 1', () => withDial('1', () => {
        assert.equal(healerBaseHealXp(0.8), 80);
        assert.equal(healerBaseHealXp(1), 100);
    }));

    it('never stores fractional XP on a fractional dial, and ignores an out-of-range value', () => {
        withDial('1.5', () => assert.equal(healerBaseHealXp(0.33), 49));
        withDial('5', () => assert.equal(healerBaseHealXp(0.8), 160, 'falls back to the default 2'));
        withDial('0', () => assert.equal(healerBaseHealXp(0.8), 160, 'the dial cannot zero heal XP'));
    });
});
