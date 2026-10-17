import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CAREER_MILESTONES } from '../../../shared/career-milestones.js';
import { passRankExam } from '../../../api/exams/_pass.js';
import { ACHIEVEMENT_RULES } from '../../../api/achievements/_catalog.js';
import { applyAchievementSync } from '../../../api/achievements/_sync.js';
import { ACHIEVEMENTS, isAchievementUnlocked } from '../constants/achievements.js';
import type { Character } from '../types/character.js';

for (const [index, milestone] of CAREER_MILESTONES.entries()) {
    test(`${milestone.name}: authoritative exam, sync, save reload and permanent profile recognition`, () => {
        const existingIds = ACHIEVEMENT_RULES.map(rule => rule.id).filter(id => !CAREER_MILESTONES.some(entry => entry.id === id));
        const character = {
            level: [20, 39, 50, 80][index], rankTitle: 'Special Jonin',
            elements: ['Fire', 'Water'], totalStatsTrained: 400,
            totalMissionsCompleted: 50, totalAiKills: 20, totalTilesExplored: 100,
            jutsuMastery: [{ level: 3 }], clan: 'Emberfall', totalPvpKills: 100, totalVillageRaids: 20,
            defeatedAiIds: ['builtin-ai-exam-proctor', 'builtin-ai-rogue-ninja'],
            examsPassed: CAREER_MILESTONES.slice(0, index).map(entry => entry.examKey),
            unlockedAchievements: existingIds, claimedAchievementRewards: existingIds,
            ryo: 1234, fateShards: 8,
        };
        const passed = passRankExam(character, milestone.examKey, { isElder: true });
        assert.equal(passed.ok, true);
        assert.ok(passed.character);
        const settled = applyAchievementSync(passed.character, 123456);
        assert.ok(settled.newlyUnlocked.includes(milestone.id));
        assert.deepEqual(settled.reward, { ryo: 0, fateShards: 0 });
        assert.equal(settled.character.ryo, character.ryo);
        assert.equal(settled.character.fateShards, character.fateShards);
        const reloaded = JSON.parse(JSON.stringify(settled.character)) as Character;
        const badge = ACHIEVEMENTS.find(entry => entry.id === milestone.id)!;
        assert.equal(isAchievementUnlocked(reloaded, badge), true, 'both profile galleries use this predicate');
        assert.equal(reloaded.achievementUnlockedAt?.[milestone.id], 123456);
        const replay = applyAchievementSync(reloaded as unknown as Record<string, unknown>, 654321);
        assert.deepEqual(replay.newlyUnlocked, []);
        assert.deepEqual(replay.reward, { ryo: 0, fateShards: 0 });
        const nextCareer = { ...reloaded, examsPassed: [] };
        assert.equal(badge.check(nextCareer), false);
        assert.equal(isAchievementUnlocked(nextCareer, badge), true, 'the earned record survives a career reset');
    });
}
