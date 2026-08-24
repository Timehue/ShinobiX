import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import {
    CARD_CLASH_AI_BASE_RYO,
    CARD_CLASH_AI_DAILY_WIN_BONUS_RYO,
    cardClashAiReward,
    cleanCardClashAiResult,
} from './_ai-reward.js';

describe('_ai-reward', () => {
    it('cleans only supported AI match results', () => {
        assert.equal(cleanCardClashAiResult('player'), 'player');
        assert.equal(cleanCardClashAiResult('opponent'), 'opponent');
        assert.equal(cleanCardClashAiResult('draw'), 'draw');
        assert.equal(cleanCardClashAiResult('win'), null);
    });

    it('pays nothing for an AI spar, in any result, with or without a prior win today', () => {
        // Owner rule: spars of any kind vs AI pay no rewards.
        for (const result of ['player', 'draw', 'opponent'] as const) {
            assert.deepEqual(cardClashAiReward(result, false), { ryo: 0, dailyBonus: false });
            assert.deepEqual(cardClashAiReward(result, true), { ryo: 0, dailyBonus: false });
        }
    });

    it('keeps the reward table zeroed so no caller can reintroduce a payout', () => {
        assert.equal(CARD_CLASH_AI_DAILY_WIN_BONUS_RYO, 0);
        assert.deepEqual(CARD_CLASH_AI_BASE_RYO, { player: 0, draw: 0, opponent: 0 });
    });
});
