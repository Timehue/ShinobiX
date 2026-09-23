import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { selectRankedOpponent, type QueueEntry } from './ranked-queue.js';

const NOW = 1_000_000;

function queued(name: string, level: number, elo: number, waitedMs: number): QueueEntry {
    return { name, level, elo, joinedAt: NOW - waitedMs, lastPolledAt: NOW };
}

describe('ranked queue equalized matchmaking', () => {
    it('pairs level 15 and level 100 immediately when their ratings are closest', () => {
        const me = queued('alice', 15, 1000, 0);
        assert.equal(selectRankedOpponent(me, [queued('bob', 100, 1000, 0)], NOW)?.name, 'bob');
    });

    it('chooses the closest Elo regardless of character level', () => {
        const me = queued('alice', 20, 1200, 0);
        const result = selectRankedOpponent(me, [
            queued('bob', 20, 1000, 0),
            queued('cara', 100, 1180, 0),
        ], NOW);
        assert.equal(result?.name, 'cara');
    });
});
