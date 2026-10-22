import { test } from 'node:test';
import assert from 'node:assert/strict';
import { publicAchievementRecord } from './_public.js';

test('public achievements preserve recognized permanent unlocks and discover saved exam receipts', () => {
    const source = {
        examsPassed: ['genin', 'chunin'], unlockedAchievements: ['exam-jonin', 'exam-jonin', 'private-field', 123],
        achievementUnlockedAt: { 'exam-jonin': 1234, 'private-field': 5678, 'exam-genin': Infinity, 'exam-chunin': -1 },
        claimedAchievementRewards: ['private-claim'], ryo: 123, inventory: ['private-item'],
    };
    const original = structuredClone(source);
    const result = publicAchievementRecord(source);
    assert.deepEqual(result, {
        unlockedAchievements: ['exam-jonin', 'exam-genin', 'exam-chunin'],
        achievementUnlockedAt: { 'exam-jonin': 1234 },
    });
    assert.deepEqual(source, original, 'public projection never mutates the save');
});

test('public achievement projection handles old saves and malformed optional ledgers', () => {
    assert.deepEqual(publicAchievementRecord({}), { unlockedAchievements: [], achievementUnlockedAt: {} });
    assert.deepEqual(publicAchievementRecord({ unlockedAchievements: 'bad', achievementUnlockedAt: [] }), {
        unlockedAchievements: [], achievementUnlockedAt: {},
    });
});
