import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Character } from '../types/character.js';
import { ACHIEVEMENTS, achievementReward, isAchievementUnlocked, unlockedAchievementCount } from './achievements.js';
import { CAREER_MILESTONES } from '../../../shared/career-milestones.js';
import { eligibleAchievementIds } from '../../../api/achievements/_catalog.js';

const character = (values: Partial<Character>): Character => ({
    level: 1,
    ryo: 0,
    bankRyo: 0,
    unspentStats: 1,
    ...values,
} as Character);

describe('achievement presentation truth', () => {
    it('describes repeatable action totals and current balances using the server eligibility rules', () => {
        const cases: Array<[string, Partial<Character>, Partial<Character>, RegExp]> = [
            ['explore-100', { totalTilesExplored: 100 }, { totalTilesExplored: 99 }, /Use Explore 100 times/],
            ['honor-100', { honorSeals: 100 }, { honorSeals: 99 }, /Hold 100 Honor Seals/],
            ['tower-25', { totalEndlessTowerWins: 25 }, { totalEndlessTowerWins: 24 }, /25 Endless Tower waves/],
            ['hollow-clear-1', { redeemedHollowGateRuns: ['ended-run'] }, { redeemedHollowGateRuns: [] }, /Extract from or forfeit/],
        ];
        for (const [id, qualifying, belowThreshold, wording] of cases) {
            const badge = ACHIEVEMENTS.find(entry => entry.id === id);
            assert.ok(badge);
            assert.match(badge.desc, wording);
            for (const [values, eligible] of [[qualifying, true], [belowThreshold, false]] as const) {
                const subject = character(values);
                assert.equal(badge.check(subject), eligible, id);
                assert.equal(eligibleAchievementIds(subject as unknown as Record<string, unknown>).includes(id), eligible, id);
            }
        }
    });

    it('uses the same exam receipt and wording for each career badge on client and server', () => {
        for (const milestone of CAREER_MILESTONES) {
            const badge = ACHIEVEMENTS.find((entry) => entry.id === milestone.id);
            assert.ok(badge);
            assert.equal(badge.name, milestone.name);
            assert.equal(badge.desc, milestone.desc);
            const earned = character({ examsPassed: [milestone.examKey] });
            assert.equal(badge.check(earned), true);
            assert.equal(badge.check(character({ level: 100 })), false);
            assert.ok(eligibleAchievementIds(earned as unknown as Record<string, unknown>).includes(badge.id));
            assert.deepEqual(achievementReward(badge), { ryo: 0, fateShards: 0 });
        }
    });
    it('keeps a ledger unlock visible after a live-state predicate becomes false', () => {
        const wealth = ACHIEVEMENTS.find((entry) => entry.id === 'ryo-25k');
        assert.ok(wealth);
        const spentLater = character({ ryo: 0, unlockedAchievements: ['ryo-25k'] });
        assert.equal(wealth.check(spentLater), false);
        assert.equal(isAchievementUnlocked(spentLater, wealth), true);
    });

    it('counts both permanent ledger unlocks and newly eligible achievements', () => {
        const result = unlockedAchievementCount(character({
            level: 10,
            unlockedAchievements: ['ryo-25k'],
        }));
        assert.ok(result >= 2);
    });

    it('exposes bounded progress for tournament and ranked-season milestones', () => {
        const tournament = ACHIEVEMENTS.find((entry) => entry.id === 'tournament-10');
        const ranked = ACHIEVEMENTS.find((entry) => entry.id === 'ranked-season-3');
        assert.deepEqual(tournament?.progress?.(character({ totalTournamentsCompleted: 4 })), {
            current: 4, target: 10, label: 'tournament wins',
        });
        assert.deepEqual(ranked?.progress?.(character({ rankedSeasonsWon: 2 })), {
            current: 2, target: 3, label: 'season victories',
        });
    });

    it('recognizes eight distinct legal core equipment slots', () => {
        const battleReady = ACHIEVEMENTS.find((entry) => entry.id === 'equipment-core-8');
        assert.ok(battleReady);
        const equipped = character({
            equipment: {
                hand: 'blade', gloves: 'gloves', body: 'vest', waist: 'belt',
                legs: 'guards', feet: 'boots', head: 'mask', thrown: 'kunai',
            },
        });
        assert.equal(battleReady.check(equipped), true);
        assert.deepEqual(battleReady.progress?.(equipped), {
            current: 8, target: 8, label: 'core slots',
        });
    });
});
