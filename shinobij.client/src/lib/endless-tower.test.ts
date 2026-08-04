import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import {
    endlessScaleFactor,
    endlessWaveReward,
    endlessTowerMilestoneReward,
} from './endless-tower';

// Character XP is retired (docs/leveling-without-xp-map.md): waves bank ryo
// only (the old xp line folds in at ~0.75:1, mirroring api/endless/_run.ts),
// and the daily tower-XP softcap subsystem is gone with it.

describe('endlessScaleFactor — wave scaling with milestone jumps', () => {
    it('is 1 at wave 1 and strictly grows', () => {
        assert.equal(endlessScaleFactor(1), 1);
        assert.ok(endlessScaleFactor(10) > endlessScaleFactor(5));
        assert.ok(endlessScaleFactor(50) > endlessScaleFactor(10));
    });
});

describe('endlessWaveReward — ryo-only banking (XP retired)', () => {
    it('banks zero xp and folds the old xp line into ryo', () => {
        const w = endlessWaveReward(3, 50);
        assert.equal(w.xp, 0);
        // base ryo (40 + 50·6 = 340) + old xp line (15 + 50·2 = 115) × 0.75,
        // both × the wave-3 scale factor.
        const factor = endlessScaleFactor(3);
        assert.equal(w.ryo, Math.floor(340 * factor) + Math.floor(115 * factor * 0.75));
    });
    it('still scales with wave and flags milestones', () => {
        assert.ok(endlessWaveReward(10, 50).ryo > endlessWaveReward(1, 50).ryo);
        assert.equal(endlessWaveReward(10, 50).isMilestone, true);
        assert.equal(endlessWaveReward(3, 50).isMilestone, false);
    });
});

describe('endlessTowerMilestoneReward — 20-wave currency cycle', () => {
    it('keeps the shipped cycle', () => {
        assert.deepEqual(endlessTowerMilestoneReward(5), { boneCharms: 5, fateShards: 0 });
        assert.deepEqual(endlessTowerMilestoneReward(15), { boneCharms: 0, fateShards: 5 });
        assert.deepEqual(endlessTowerMilestoneReward(20), { boneCharms: 5, fateShards: 5 });
        assert.deepEqual(endlessTowerMilestoneReward(3), { boneCharms: 0, fateShards: 0 });
    });
});
