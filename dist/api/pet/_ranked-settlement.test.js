"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const node_assert_1 = require("node:assert");
const _ranked_settlement_js_1 = require("./_ranked-settlement.js");
const unresolved = {
    a: 'alpha',
    b: 'bravo',
    aRating: 1100,
    bRating: 900,
    createdAt: 100,
};
const resolved = {
    ...unresolved,
    resolution: {
        authority: 'server-engine-v1',
        winner: 'b',
        resolvedAt: 200,
        engineDigest: '0123456789abcdef',
    },
};
(0, node_test_1.describe)('_ranked-settlement', () => {
    (0, node_test_1.it)('keeps ranked pet starts server-disabled by default', () => {
        node_assert_1.strict.equal((0, _ranked_settlement_js_1.petRankedStartsEnabled)(), false);
    });
    (0, node_test_1.it)('rejects a ratings-only token because it does not prove an outcome', () => {
        node_assert_1.strict.deepEqual((0, _ranked_settlement_js_1.derivePetRankedSettlement)(unresolved, 'alpha', 'win'), {
            ok: false,
            reason: 'server-resolution-required',
        });
    });
    (0, node_test_1.it)('derives both sides from the server winner instead of the first reporter', () => {
        const winner = (0, _ranked_settlement_js_1.derivePetRankedSettlement)(resolved, 'bravo', 'win');
        node_assert_1.strict.equal(winner.ok, true);
        if (winner.ok)
            node_assert_1.strict.deepEqual(winner.settlement, {
                callerRole: 'winner',
                authoritativeOutcome: 'win',
                winnerName: 'bravo',
                loserName: 'alpha',
                winnerRating: 900,
                loserRating: 1100,
            });
        const loser = (0, _ranked_settlement_js_1.derivePetRankedSettlement)(resolved, 'alpha', 'loss');
        node_assert_1.strict.equal(loser.ok, true);
        if (loser.ok)
            node_assert_1.strict.equal(loser.settlement.callerRole, 'loser');
    });
    (0, node_test_1.it)('rejects a conflicting report without changing the sealed winner', () => {
        node_assert_1.strict.deepEqual((0, _ranked_settlement_js_1.derivePetRankedSettlement)(resolved, 'alpha', 'win'), {
            ok: false,
            reason: 'conflicting-client-outcome',
        });
        node_assert_1.strict.deepEqual((0, _ranked_settlement_js_1.derivePetRankedSettlement)(resolved, 'bravo', 'loss'), {
            ok: false,
            reason: 'conflicting-client-outcome',
        });
    });
    (0, node_test_1.it)('rejects malformed server resolution metadata', () => {
        const malformed = {
            ...resolved,
            resolution: { ...resolved.resolution, engineDigest: 'short' },
        };
        node_assert_1.strict.deepEqual((0, _ranked_settlement_js_1.derivePetRankedSettlement)(malformed, 'bravo', 'win'), {
            ok: false,
            reason: 'invalid-server-resolution',
        });
    });
});
