import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { rankedLevelBand, selectRankedOpponent, type QueueEntry } from './ranked-queue.js';

const NOW = 1_000_000;

function queued(name: string, level: number, elo: number, waitedMs: number): QueueEntry {
    return { name, level, elo, joinedAt: NOW - waitedMs, lastPolledAt: NOW };
}

describe('ranked queue level-band schedule', () => {
    it('starts at +/-10 and widens by exactly one level every 15 seconds', () => {
        assert.equal(rankedLevelBand(NOW, NOW), 10);
        assert.equal(rankedLevelBand(NOW - 14_999, NOW), 10);
        assert.equal(rankedLevelBand(NOW - 15_000, NOW), 11);
        assert.equal(rankedLevelBand(NOW - 30_000, NOW), 12);
    });

    it('does not immediately fall back to an opponent outside the level band', () => {
        const me = queued('alice', 20, 1000, 0);
        assert.equal(selectRankedOpponent(me, [queued('bob', 31, 1000, 0)], NOW), undefined);
    });

    it('allows an 11-level gap only after both players waited 15 seconds', () => {
        const me = queued('alice', 20, 1000, 15_000);
        assert.equal(selectRankedOpponent(me, [queued('bob', 31, 1000, 0)], NOW), undefined);
        assert.equal(selectRankedOpponent(me, [queued('bob', 31, 1000, 15_000)], NOW)?.name, 'bob');
    });

    it('chooses the closest Elo among mutually eligible opponents', () => {
        const me = queued('alice', 20, 1200, 0);
        const result = selectRankedOpponent(me, [
            queued('bob', 20, 1000, 0),
            queued('cara', 25, 1180, 0),
        ], NOW);
        assert.equal(result?.name, 'cara');
    });
});
