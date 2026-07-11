import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import {
    derivePetRankedSettlement,
    petRankedStartsEnabled,
    type ServerResolvedPetRankedToken,
} from './_ranked-settlement.js';

const unresolved: ServerResolvedPetRankedToken = {
    a: 'alpha',
    b: 'bravo',
    aRating: 1100,
    bRating: 900,
    createdAt: 100,
};

const resolved: ServerResolvedPetRankedToken = {
    ...unresolved,
    resolution: {
        authority: 'server-engine-v1',
        winner: 'b',
        resolvedAt: 200,
        engineDigest: '0123456789abcdef',
    },
};

describe('_ranked-settlement', () => {
    it('keeps ranked pet starts server-disabled by default', () => {
        assert.equal(petRankedStartsEnabled(), false);
    });

    it('rejects a ratings-only token because it does not prove an outcome', () => {
        assert.deepEqual(derivePetRankedSettlement(unresolved, 'alpha', 'win'), {
            ok: false,
            reason: 'server-resolution-required',
        });
    });

    it('derives both sides from the server winner instead of the first reporter', () => {
        const winner = derivePetRankedSettlement(resolved, 'bravo', 'win');
        assert.equal(winner.ok, true);
        if (winner.ok) assert.deepEqual(winner.settlement, {
            callerRole: 'winner',
            authoritativeOutcome: 'win',
            winnerName: 'bravo',
            loserName: 'alpha',
            winnerRating: 900,
            loserRating: 1100,
        });

        const loser = derivePetRankedSettlement(resolved, 'alpha', 'loss');
        assert.equal(loser.ok, true);
        if (loser.ok) assert.equal(loser.settlement.callerRole, 'loser');
    });

    it('rejects a conflicting report without changing the sealed winner', () => {
        assert.deepEqual(derivePetRankedSettlement(resolved, 'alpha', 'win'), {
            ok: false,
            reason: 'conflicting-client-outcome',
        });
        assert.deepEqual(derivePetRankedSettlement(resolved, 'bravo', 'loss'), {
            ok: false,
            reason: 'conflicting-client-outcome',
        });
    });

    it('rejects malformed server resolution metadata', () => {
        const malformed = {
            ...resolved,
            resolution: { ...resolved.resolution!, engineDigest: 'short' },
        };
        assert.deepEqual(derivePetRankedSettlement(malformed, 'bravo', 'win'), {
            ok: false,
            reason: 'invalid-server-resolution',
        });
    });
});
