import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { applyTrainingGrant } from './_grant.js';

// Stat-derived leveling (docs/leveling-without-xp-map.md): training grants the
// stat directly, rolls rank-cap overflow into the pool (earned progress is
// never destroyed), and ends with the rise-only derived-level recompute.

describe('server training grant', () => {
    it('applies the sealed stat gain directly; xp stays frozen and level derives from earned', () => {
        const out = applyTrainingGrant({ level: 1, xp: 0, stats: { strength: 10 }, unspentStats: 20 }, 'strength', 12, 0);
        assert.equal((out.character.stats as Record<string, number>).strength, 22);
        assert.equal(out.character.totalStatsTrained, 12);
        assert.equal(out.character.level, 1); // earned 32 is far below the L2 threshold (200)
        assert.equal(out.character.xp, 0);    // frozen field untouched
        assert.equal(out.overflow, 0);
    });

    it('levels the character up when the grant pushes the earned ledger past a threshold', () => {
        const out = applyTrainingGrant({ level: 1, stats: { strength: 10 }, unspentStats: 300 }, 'strength', 100, 0);
        assert.equal((out.character.stats as Record<string, number>).strength, 110);
        assert.equal(out.character.level, 3); // earned 100 + 300 = 400 = earnedForLevel(3)
    });

    it('caps the applied stat at the rank ceiling and rolls the overflow into the pool', () => {
        const out = applyTrainingGrant({ level: 1, xp: 0, stats: { strength: 349 }, totalStatsTrained: 5 }, 'strength', 50, 0);
        assert.equal((out.character.stats as Record<string, number>).strength, 350);
        assert.equal(out.applied, 1);
        assert.equal(out.overflow, 49);
        assert.equal(out.character.unspentStats, 49); // cap-truncated points are NOT destroyed
        assert.equal(out.character.totalStatsTrained, 6);
        assert.equal(out.character.level, 2); // earned 340 + 49 = 389 ≥ earnedForLevel(2)=200
    });
});
