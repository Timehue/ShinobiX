import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { rankedLevelBand, selectRankedOpponent, type QueueEntry } from './ranked-queue.js';

const NOW = 1_000_000;

function queued(name: string, level: number, elo: number, waitedMs: number): QueueEntry {
    return { name, level, elo, joinedAt: NOW - waitedMs, lastPolledAt: NOW };
}

describe('ranked queue level-band schedule', () => {
    it('starts at +/-2, widens every 30 seconds, and hard-caps at +/-5', () => {
        assert.equal(rankedLevelBand(NOW, NOW), 2);
        assert.equal(rankedLevelBand(NOW - 29_999, NOW), 2);
        assert.equal(rankedLevelBand(NOW - 30_000, NOW), 3);
        assert.equal(rankedLevelBand(NOW - 90_000, NOW), 5);
        assert.equal(rankedLevelBand(NOW - 60 * 60_000, NOW), 5);
    });

    it('does not immediately fall back to an opponent outside the level band', () => {
        const me = queued('alice', 20, 1000, 0);
        assert.equal(selectRankedOpponent(me, [queued('bob', 23, 1000, 0)], NOW), undefined);
    });

    it('allows a 3-level gap only after both players waited 30 seconds', () => {
        const me = queued('alice', 20, 1000, 30_000);
        assert.equal(selectRankedOpponent(me, [queued('bob', 23, 1000, 0)], NOW), undefined);
        assert.equal(selectRankedOpponent(me, [queued('bob', 23, 1000, 30_000)], NOW)?.name, 'bob');
    });

    it('never crosses a combat progression breakpoint or exceeds five levels', () => {
        const waited = 60 * 60_000;
        assert.equal(selectRankedOpponent(queued('alice', 14, 1000, waited), [queued('bob', 15, 1000, waited)], NOW), undefined);
        assert.equal(selectRankedOpponent(queued('alice', 20, 1000, waited), [queued('bob', 26, 1000, waited)], NOW), undefined);
        assert.equal(selectRankedOpponent(queued('alice', 20, 1000, waited), [queued('bob', 25, 1000, waited)], NOW)?.name, 'bob');
    });

    it('chooses the closest Elo among mutually eligible opponents', () => {
        const me = queued('alice', 20, 1200, 0);
        const result = selectRankedOpponent(me, [
            queued('bob', 20, 1000, 0),
            queued('cara', 22, 1180, 0),
        ], NOW);
        assert.equal(result?.name, 'cara');
    });
});
