import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import {
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

    it('pays the first win bonus once', () => {
        assert.deepEqual(cardClashAiReward('player', false), { ryo: 50 + CARD_CLASH_AI_DAILY_WIN_BONUS_RYO, dailyBonus: true });
        assert.deepEqual(cardClashAiReward('player', true), { ryo: 50, dailyBonus: false });
        assert.deepEqual(cardClashAiReward('draw', false), { ryo: 15, dailyBonus: false });
        assert.deepEqual(cardClashAiReward('opponent', false), { ryo: 5, dailyBonus: false });
    });
});
