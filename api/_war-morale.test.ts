import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
    resolveWarMorale,
    applyMoraleToGain,
    NEUTRAL_MORALE,
    WAR_DEBUFF_TRAINING_XP_MULT,
    WAR_DEBUFF_JUTSU_TIME_MULT,
    WAR_BUFF_TRAINING_XP_MULT,
    WAR_BUFF_JUTSU_TIME_MULT,
    settlementMoralePatch,
} from './_war-morale.js';
import { jutsuRyoTrainingDuration } from './training/_jutsu-ryo.js';

const NOW = Date.UTC(2026, 7, 6, 12, 0, 0);
const DAY = 24 * 60 * 60 * 1000;

describe('war morale (server)', () => {
    it('is neutral with no stamps, and neutral means exactly 1', () => {
        const m = resolveWarMorale({}, NOW);
        assert.deepEqual(m, NEUTRAL_MORALE);
        assert.equal(m.xpMult, 1);
        assert.equal(m.jutsuTimeMult, 1);
    });

    it('ignores expired windows', () => {
        assert.equal(resolveWarMorale({ warLossDebuffUntil: NOW - 1, warWinBuffUntil: NOW - DAY }, NOW).morale, 'none');
    });

    it('applies each side’s multipliers', () => {
        const loss = resolveWarMorale({ warLossDebuffUntil: NOW + DAY }, NOW);
        assert.equal(loss.morale, 'rallying');
        assert.equal(loss.xpMult, WAR_DEBUFF_TRAINING_XP_MULT);
        assert.equal(loss.jutsuTimeMult, WAR_DEBUFF_JUTSU_TIME_MULT);
        const win = resolveWarMorale({ warWinBuffUntil: NOW + DAY }, NOW);
        assert.equal(win.morale, 'triumphant');
        assert.equal(win.xpMult, WAR_BUFF_TRAINING_XP_MULT);
        assert.equal(win.jutsuTimeMult, WAR_BUFF_JUTSU_TIME_MULT);
    });

    it('lets the most RECENT settlement win', () => {
        assert.equal(resolveWarMorale({ warWinBuffUntil: NOW + 1000, warLossDebuffUntil: NOW + DAY }, NOW).morale, 'rallying');
        assert.equal(resolveWarMorale({ warLossDebuffUntil: NOW + 1000, warWinBuffUntil: NOW + DAY }, NOW).morale, 'triumphant');
    });

    it('survives garbage stamps', () => {
        assert.equal(resolveWarMorale({ warLossDebuffUntil: 'soon' }, NOW).morale, 'none');
        assert.equal(resolveWarMorale(null, NOW).morale, 'none');
    });

    it('ends a comeback rally when that village wins its next war', () => {
        const afterLoss = { ...settlementMoralePatch('loser', NOW) };
        assert.equal(resolveWarMorale(afterLoss, NOW + DAY).morale, 'rallying');

        const afterRematchWin = {
            ...afterLoss,
            ...settlementMoralePatch('winner', NOW + DAY),
        };
        assert.equal(resolveWarMorale(afterRematchWin, NOW + DAY).morale, 'none');
        assert.equal(Number(afterRematchWin.warLossDebuffUntil), 0);
    });
});

describe('applyMoraleToGain', () => {
    it('scales a sealed gain in both directions', () => {
        assert.equal(applyMoraleToGain(100, 0.9), 90);
        assert.equal(applyMoraleToGain(100, 1.1), 110);
        assert.equal(applyMoraleToGain(100, 1), 100);
    });
    it('never turns a real gain into nothing — slower, not stopped', () => {
        assert.equal(applyMoraleToGain(1, 0.9), 1);
        assert.equal(applyMoraleToGain(2, 0.1), 1);
    });
    it('keeps a zero gain at zero', () => {
        assert.equal(applyMoraleToGain(0, 1.1), 0);
        assert.equal(applyMoraleToGain(-5, 1.1), 0);
    });
});

describe('jutsu training duration × morale', () => {
    const L = 12; // 30-minute base tier

    it('is unchanged at neutral morale', () => {
        assert.equal(jutsuRyoTrainingDuration(L, 0), jutsuRyoTrainingDuration(L, 0, 1));
    });

    it('speeds up a rallying village after a loss', () => {
        const normal = jutsuRyoTrainingDuration(L, 0, 1);
        const rallying = jutsuRyoTrainingDuration(L, 0, WAR_DEBUFF_JUTSU_TIME_MULT);
        assert.ok(rallying < normal);
        assert.equal(rallying, Math.floor(normal * 0.9));
    });

    it('keeps legacy triumphant stamps progression-neutral', () => {
        assert.equal(jutsuRyoTrainingDuration(L, 0, WAR_BUFF_JUTSU_TIME_MULT), jutsuRyoTrainingDuration(L, 0, 1));
    });

    it('stacks with, rather than replacing, the player’s own bonus', () => {
        const bonused = jutsuRyoTrainingDuration(L, 50, 1);
        assert.ok(jutsuRyoTrainingDuration(L, 50, WAR_DEBUFF_JUTSU_TIME_MULT) < bonused);
        assert.equal(jutsuRyoTrainingDuration(L, 50, WAR_BUFF_JUTSU_TIME_MULT), bonused);
    });

    it('clamps a nonsense multiplier and keeps the one-minute floor', () => {
        assert.equal(jutsuRyoTrainingDuration(L, 0, 999), jutsuRyoTrainingDuration(L, 0, 2));
        assert.equal(jutsuRyoTrainingDuration(L, 0, -5), jutsuRyoTrainingDuration(L, 0, 0.5));
        assert.ok(jutsuRyoTrainingDuration(L, 60, 0.5) >= 60_000);
    });
});
