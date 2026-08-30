import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Character } from '../types/character.js';
import { ACHIEVEMENTS, isAchievementUnlocked, unlockedAchievementCount } from './achievements.js';

const character = (values: Partial<Character>): Character => ({
    level: 1,
    ryo: 0,
    bankRyo: 0,
    unspentStats: 1,
    ...values,
} as Character);

describe('achievement presentation truth', () => {
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
