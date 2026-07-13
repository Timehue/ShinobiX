import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { applyTrainingGrant } from './_grant.js';

describe('server training grant', () => {
    it('applies sealed XP and stat gain to the stored character', () => {
        const out = applyTrainingGrant({ level: 1, xp: 0, stats: { strength: 10 }, unspentStats: 20 }, 'strength', 12, 6);
        assert.equal(out.character.level, 2);
        assert.equal(out.character.xp, 0);
        assert.equal((out.character.stats as Record<string, number>).strength, 22);
        assert.equal(out.character.totalStatsTrained, 12);
    });

    it('caps the applied stat at the character rank ceiling', () => {
        const out = applyTrainingGrant({ level: 1, xp: 0, stats: { strength: 349 }, totalStatsTrained: 5 }, 'strength', 50, 0);
        assert.equal((out.character.stats as Record<string, number>).strength, 350);
        assert.equal(out.applied, 1);
        assert.equal(out.character.totalStatsTrained, 6);
    });
});
