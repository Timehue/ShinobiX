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
    it('records existing exam receipts without paying or changing character power', () => {
        const input = { examsPassed: ['genin', 'chunin', 'jonin', 'specialJonin'], ryo: 1234, fateShards: 8, level: 1, unlockedAchievements: [], claimedAchievementRewards: [] };
        const first = applyAchievementSync(input, 42);
        assert.deepEqual(first.newlyUnlocked, ['exam-genin', 'exam-chunin', 'exam-jonin', 'exam-special-jonin', 'secret-exams-3']);
        // The existing Trial Walker reward remains unchanged; new distinctions pay zero.
        assert.deepEqual(first.reward, { ryo: 3000, fateShards: 1 });
        const replay = applyAchievementSync(first.character, 43);
        assert.deepEqual(replay.reward, { ryo: 0, fateShards: 0 });
        assert.equal((replay.character as Record<string, unknown>).level, input.level);
        assert.equal(replay.character.achievementUnlockedAt['exam-chunin'], 42);
    });
    it('does not let career recognition advance an existing achievement-count payout', () => {
        const unlocked = [...Array.from({ length: 24 }, (_, i) => `old-${i}`), 'exam-genin', 'exam-chunin', 'exam-jonin', 'exam-special-jonin'];
        const out = applyAchievementSync({ unlockedAchievements: unlocked, claimedAchievementRewards: unlocked, ryo: 100, fateShards: 0 });
        assert.equal(out.eligible.includes('achievements-25'), false);
        assert.deepEqual(out.reward, { ryo: 0, fateShards: 0 });
    });
});
