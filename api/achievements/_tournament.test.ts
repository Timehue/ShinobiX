import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { applyTournamentVictory } from './_tournament.js';

describe('official tournament achievement credit', () => {
    it('credits the first win and its achievement exactly once', () => {
        const initial = { totalTournamentsCompleted: 0, unlockedAchievements: [], claimedAchievementRewards: [], ryo: 0, fateShards: 0 };
        const first = applyTournamentVictory(initial, 'tourney-1');
        assert.equal(first.replayed, false);
        assert.equal(first.character.totalTournamentsCompleted, 1);
        assert.ok((first.character.unlockedAchievements as string[]).includes('tournament-first'));
        assert.deepEqual(first.character.tournamentWinReceipts, ['tourney-1']);

        const replay = applyTournamentVictory(first.character, 'tourney-1');
        assert.equal(replay.replayed, true);
        assert.equal(replay.character.totalTournamentsCompleted, 1);
    });

    it('unlocks the three-win and ten-win tournament milestones', () => {
        let character: Record<string, unknown> = { totalTournamentsCompleted: 0, unlockedAchievements: [], claimedAchievementRewards: [], ryo: 0, fateShards: 0 };
        for (let i = 1; i <= 10; i += 1) character = applyTournamentVictory(character, `tourney-${i}`).character;
        const unlocked = character.unlockedAchievements as string[];
        assert.ok(unlocked.includes('tournament-first'));
        assert.ok(unlocked.includes('tournament-3'));
        assert.ok(unlocked.includes('tournament-10'));
        assert.ok((character.earnedTitles as string[]).includes('Arena Champion'));
        assert.ok((character.earnedTitles as string[]).includes('Colosseum Legend'));
    });
});
