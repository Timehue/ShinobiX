import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ACHIEVEMENT_RULES, ACHIEVEMENT_TITLES, achievementRewardForIds, eligibleAchievementIds } from './_catalog.js';

describe('achievement authority catalog', () => {
    it('has exact ID parity with the client catalog', () => {
        const source = readFileSync('shinobij.client/src/constants/achievements.ts', 'utf8');
        const clientIds = [...source.matchAll(/\bid:\s*"([^"]+)"/g)].map((match) => match[1]);
        assert.deepEqual(new Set(ACHIEVEMENT_RULES.map((rule) => rule.id)), new Set(clientIds));
        assert.equal(ACHIEVEMENT_RULES.length, clientIds.length);
        const titleBlock = source.match(/TITLE_ACHIEVEMENT_IDS[\s\S]*?\]\);/)?.[0] ?? '';
        const clientTitleIds = [...titleBlock.matchAll(/"([a-z0-9-]+)"/g)].map((match) => match[1]);
        assert.deepEqual(new Set(Object.keys(ACHIEVEMENT_TITLES)), new Set(clientTitleIds));
        assert.equal(ACHIEVEMENT_RULES.length, 135, 'the full RPG catalog remains intact');
    });
    it('evaluates numeric and compound rules from stored state', () => {
        const ids = eligibleAchievementIds({ level: 100, ryo: 1_000_000, bankRyo: 0, itemStacks: [{ itemId: 'x', count: 100 }], weeklyBossKills: { a: 1, b: 1, c: 1, d: 1, e: 1 }, unspentStats: 0 });
        for (const id of ['level-10', 'level-100', 'ryo-25k', 'secret-untouched', 'secret-packrat', 'secret-weekly-bosses-5', 'secret-minmaxer']) assert.ok(ids.includes(id), id);
    });
    it('uses canonical public and hidden rewards', () => {
        assert.deepEqual(achievementRewardForIds(['level-10', 'secret-packrat']), { ryo: 5000, fateShards: 1 });
    });

    it('covers the major RPG and competitive systems from persisted counters', () => {
        const ids = eligibleAchievementIds({
            totalStatsTrained: 1000,
            jutsuMastery: Array.from({ length: 10 }, () => ({ level: 40 })),
            storyProgress: 9,
            redeemedQuestbookRuns: ['road-1', 'road-2', 'road-3', 'road-4', 'road-5'],
            legacy: { stage: 5 },
            profession: 'Weaponsmith',
            professionRank: 10,
            masterySpec: { forge: 6, temper: 4 },
            redeemedHollowGateRuns: Array.from({ length: 50 }, (_, i) => `gate-${i}`),
            hollowGateWardenKills: 25,
            redeemedDungeonRuns: Array.from({ length: 25 }, (_, i) => `dungeon-${i}`),
            pets: [{ level: 50, maxLevel: 50, evolutionStage: 2 }],
            activePetId: 'pet-a',
            activePetId2v2: 'pet-b',
            petRankedRating: 1800,
            starterCardsClaimed: true,
            cardClashWins: 100,
            cardClashDeck: Array.from({ length: 40 }, (_, i) => `card-${i}`),
            tileCards: Array.from({ length: 25 }, (_, i) => `unique-${i}`),
            redeemedCrafts: Array.from({ length: 25 }, (_, i) => `craft-${i}`),
            redeemedNamedForges: ['named-blade'],
            equipment: {
                hand: 'blade', gloves: 'gloves', body: 'vest', waist: 'belt',
                legs: 'guards', feet: 'boots', head: 'mask', thrown: 'kunai',
            },
            totalTournamentsCompleted: 10,
            rankedSeasonsWon: 3,
            warsWon: 10,
            warMvpCount: 10,
            lifetimeWarDamage: 1_000_000,
            unlockedAchievements: Array.from({ length: 125 }, (_, i) => `earned-${i}`),
        });
        for (const id of [
            'training-1000', 'jutsu-versatile-10', 'story-chapter-9', 'questbook-5', 'legacy-stage-5',
            'profession-rank-10', 'profession-mastery-10', 'hollow-clear-50', 'hollow-warden-25',
            'dungeon-clear-25', 'pet-level-max', 'pet-evolution-2', 'pet-ranked-1800',
            'chronicle-win-100', 'chronicle-deck-40', 'chronicle-unique-25', 'craft-25',
            'named-forge-first', 'equipment-core-8', 'tournament-first', 'tournament-3', 'tournament-10',
            'ranked-season-champ', 'ranked-season-3', 'war-win-10', 'war-mvp-10',
            'war-damage-1m', 'achievements-125',
        ]) assert.ok(ids.includes(id), id);
    });
});
