import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
    playerRankedAuthorityFromChallenge,
    playerRankedAuthorityFromQueueMatch,
} from './player-ranked-authority';

const MATCH_ID = 'player-ranked-12345678-1234-4123-8123-1234567890ab';

describe('player-ranked client authority', () => {
    it('maps the exact queue capability into challenge/session field names', () => {
        assert.deepEqual(playerRankedAuthorityFromQueueMatch({
            matchId: MATCH_ID,
            seasonId: 7,
            seasonEpoch: 9,
            opponent: 'rival',
        }), {
            rankedMatchId: MATCH_ID,
            rankedSeasonId: 7,
            rankedSeasonEpoch: 9,
        });
    });

    it('fails closed when any match, season, or epoch field is missing or malformed', () => {
        assert.equal(playerRankedAuthorityFromQueueMatch({ matchId: MATCH_ID, seasonId: 7 }), null);
        assert.equal(playerRankedAuthorityFromQueueMatch({ matchId: 'forged', seasonId: 7, seasonEpoch: 9 }), null);
        assert.equal(playerRankedAuthorityFromChallenge({
            rankedMatchId: MATCH_ID,
            rankedSeasonId: 7,
            rankedSeasonEpoch: 0,
        }), null);
    });

    it('revalidates the unchanged capability after the challenge inbox hop', () => {
        assert.deepEqual(playerRankedAuthorityFromChallenge({
            rankedMatchId: MATCH_ID,
            rankedSeasonId: 7,
            rankedSeasonEpoch: 9,
        }), {
            rankedMatchId: MATCH_ID,
            rankedSeasonId: 7,
            rankedSeasonEpoch: 9,
        });
    });
});
