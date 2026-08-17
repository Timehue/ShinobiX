import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
    INITIAL_PVP_STATE_REVISION,
    nextPvpStateRevision,
    pvpSessionHasRankedCloseFence,
} from './session';

describe('PvP server projection revision', () => {
    it('upgrades a legacy row and advances each current server revision once', () => {
        assert.equal(INITIAL_PVP_STATE_REVISION, 1);
        assert.equal(nextPvpStateRevision({}), 1);
        assert.equal(nextPvpStateRevision({ stateRevision: 1 }), 2);
        assert.equal(nextPvpStateRevision({ stateRevision: 41 }), 42);
    });

    it('fails closed instead of wrapping or repairing malformed authority', () => {
        assert.throws(() => nextPvpStateRevision({ stateRevision: -1 }), /revision-invalid/);
        assert.throws(() => nextPvpStateRevision({ stateRevision: 1.5 }), /revision-invalid/);
        assert.throws(() => nextPvpStateRevision({ stateRevision: Number.MAX_SAFE_INTEGER }), /revision-invalid/);
    });

    it('classifies only an internally bound ranked close fence as terminal control', () => {
        const fenced = {
            battleId: 'battle-1',
            status: 'active',
            ranked: false,
            rankedKind: 'player',
            playerRankedAuthorityVersion: 2,
            rankedMatchId: 'player-ranked-match',
            rankedSeasonId: 3,
            rankedSeasonEpoch: 8,
            rewardAuthority: 'ranked',
            baseRewards: false,
            rankedCloseFence: {
                version: 'player-ranked-session-close-fence-v1',
                matchId: 'player-ranked-match',
                seasonId: 3,
                seasonEpoch: 8,
                transitionId: 'ranked-season-3-4',
                fencedAt: 100,
            },
        };
        assert.equal(pvpSessionHasRankedCloseFence(fenced), true);
        assert.equal(pvpSessionHasRankedCloseFence({
            ...fenced,
            rankedCloseFence: { ...fenced.rankedCloseFence, matchId: 'other' },
        }), false);
    });
});
