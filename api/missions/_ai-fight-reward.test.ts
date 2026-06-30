import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import {
    aiFightReward, AI_FIGHT_SOFT_CAP_PER_DAY, AI_FIGHT_REDUCED_MULT,
    MAX_AI_FIGHT_XP, MAX_AI_FIGHT_RYO,
} from './_ai-fight-reward.js';

describe('_ai-fight-reward — daily soft-cap (P0.2b)', () => {
    it('first win of the day pays full reward', () => {
        const r = aiFightReward(125, 90, 1);
        assert.deepEqual(r, { xp: 125, ryo: 90, capped: false });
    });

    it('pays full reward up to (and including) the soft cap', () => {
        const r = aiFightReward(100, 75, AI_FIGHT_SOFT_CAP_PER_DAY);
        assert.deepEqual(r, { xp: 100, ryo: 75, capped: false });
    });

    it('reduces the reward past the soft cap', () => {
        const r = aiFightReward(100, 80, AI_FIGHT_SOFT_CAP_PER_DAY + 1);
        assert.equal(r.xp, Math.floor(100 * AI_FIGHT_REDUCED_MULT));
        assert.equal(r.ryo, Math.floor(80 * AI_FIGHT_REDUCED_MULT));
        assert.equal(r.capped, true);
    });

    it('clamps the per-fight base (anti-inflation)', () => {
        const r = aiFightReward(99999, 99999, 1);
        assert.equal(r.xp, MAX_AI_FIGHT_XP);
        assert.equal(r.ryo, MAX_AI_FIGHT_RYO);
    });

    it('handles non-numeric / negative input safely', () => {
        assert.deepEqual(aiFightReward('x', -50, 1), { xp: 0, ryo: 0, capped: false });
    });
});
