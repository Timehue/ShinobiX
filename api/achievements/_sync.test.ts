import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { applyAchievementSync } from './_sync.js';

describe('achievement sync settlement', () => {
    it('silently seeds first-load eligibility without a retroactive payout', () => {
        const out = applyAchievementSync({ level: 10, ryo: 0, fateShards: 0 }, 123);
        assert.ok(out.character.unlockedAchievements.includes('level-10'));
        assert.ok(out.character.claimedAchievementRewards.includes('level-10'));
        assert.equal(out.character.ryo, 0); assert.deepEqual(out.newlyRewarded, []);
    });
    it('pays each newly eligible achievement once', () => {
        const first = applyAchievementSync({ level: 9, ryo: 0, fateShards: 0, unlockedAchievements: [], claimedAchievementRewards: [] }, 1);
        const earned = applyAchievementSync({ ...first.character, level: 10 }, 2);
        assert.deepEqual(earned.newlyRewarded, ['level-10']); assert.equal(earned.character.ryo, 2000);
        const replay = applyAchievementSync(earned.character, 3);
        assert.deepEqual(replay.newlyRewarded, []); assert.equal(replay.character.ryo, 2000);
    });
    it('treats legacy unlocked IDs as already claimed during migration', () => {
        const out = applyAchievementSync({ level: 10, ryo: 0, unlockedAchievements: ['level-10'] });
        assert.equal(out.character.ryo, 0); assert.deepEqual(out.newlyRewarded, []);
    });
    it('backfills wearable titles from server-eligible achievements', () => {
        const out = applyAchievementSync({ level: 100, ryo: 0, unlockedAchievements: [], claimedAchievementRewards: [] });
        assert.ok(out.character.earnedTitles.includes('Centenarian'));
    });
});
