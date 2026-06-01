"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const node_assert_1 = require("node:assert");
const _ranked_rating_js_1 = require("./_ranked-rating.js");
// Pins the server rating math to the client's formula
// (shinobij.client/src/lib/progression.ts rankedDelta) so moving the
// computation server-side is a ZERO behavior change. If the client formula ever
// changes, these expected values must change in lockstep — that's the point.
(0, node_test_1.describe)('rankedDelta (verbatim port of client progression.ts)', () => {
    (0, node_test_1.it)('gives 12 for an even match (K/2)', () => {
        node_assert_1.strict.equal((0, _ranked_rating_js_1.rankedDelta)(1000, 1000), 12);
    });
    (0, node_test_1.it)('floors a heavy favorite winning at 8', () => {
        node_assert_1.strict.equal((0, _ranked_rating_js_1.rankedDelta)(1200, 1000), 8); // expected ~5.77 -> round 6 -> floor 8
        node_assert_1.strict.equal((0, _ranked_rating_js_1.rankedDelta)(1400, 1000), 8); // expected ~2.18 -> round 2 -> floor 8
    });
    (0, node_test_1.it)('rewards an underdog upset with more than the floor', () => {
        node_assert_1.strict.equal((0, _ranked_rating_js_1.rankedDelta)(1000, 1200), 18); // ~18.23 -> 18
        node_assert_1.strict.equal((0, _ranked_rating_js_1.rankedDelta)(1000, 1400), 22); // ~21.82 -> 22
    });
    (0, node_test_1.it)('is never below the floor of 8', () => {
        for (let w = 800; w <= 2000; w += 137) {
            for (let l = 800; l <= 2000; l += 211) {
                node_assert_1.strict.ok((0, _ranked_rating_js_1.rankedDelta)(w, l) >= 8, `delta(${w},${l}) >= 8`);
            }
        }
    });
});
(0, node_test_1.describe)('creditRankedOutcome', () => {
    (0, node_test_1.it)('winner gains the delta and a win (player ladder)', () => {
        const r = (0, _ranked_rating_js_1.creditRankedOutcome)({ rankedRating: 1000, rankedWins: 3 }, {
            role: 'winner', winnerRating: 1000, loserRating: 1000, kind: 'player',
        });
        node_assert_1.strict.equal(r.delta, 12);
        node_assert_1.strict.equal(r.newRating, 1012);
        node_assert_1.strict.deepEqual(r.patch, { rankedRating: 1012, rankedWins: 4 });
    });
    (0, node_test_1.it)('loser loses the same delta and a loss (player ladder)', () => {
        const r = (0, _ranked_rating_js_1.creditRankedOutcome)({ rankedRating: 1000, rankedLosses: 2 }, {
            role: 'loser', winnerRating: 1000, loserRating: 1000, kind: 'player',
        });
        node_assert_1.strict.equal(r.delta, 12);
        node_assert_1.strict.equal(r.newRating, 988);
        node_assert_1.strict.deepEqual(r.patch, { rankedRating: 988, rankedLosses: 3 });
    });
    (0, node_test_1.it)('floors the loser rating at 0', () => {
        const r = (0, _ranked_rating_js_1.creditRankedOutcome)({ rankedRating: 5 }, {
            role: 'loser', winnerRating: 1000, loserRating: 5, kind: 'player',
        });
        node_assert_1.strict.equal(r.newRating, 0, 'never goes negative');
        node_assert_1.strict.equal(r.patch.rankedRating, 0);
        node_assert_1.strict.equal(r.patch.rankedLosses, 1, 'losses initialised from 0');
    });
    (0, node_test_1.it)('defaults missing/garbage rating to 1000 and counters to 0', () => {
        const win = (0, _ranked_rating_js_1.creditRankedOutcome)({}, { role: 'winner', winnerRating: 1000, loserRating: 1000, kind: 'player' });
        node_assert_1.strict.equal(win.newRating, _ranked_rating_js_1.DEFAULT_RANKED_RATING + 12);
        node_assert_1.strict.deepEqual(win.patch, { rankedRating: 1012, rankedWins: 1 });
        const garbage = (0, _ranked_rating_js_1.creditRankedOutcome)({ rankedRating: 'oops' }, {
            role: 'winner', winnerRating: 1000, loserRating: 1000, kind: 'player',
        });
        node_assert_1.strict.equal(garbage.newRating, 1012, 'NaN rating falls back to 1000');
    });
    (0, node_test_1.it)('uses the pet fields for the pet ladder', () => {
        const r = (0, _ranked_rating_js_1.creditRankedOutcome)({ petRankedRating: 1500, petRankedWins: 10 }, {
            role: 'winner', winnerRating: 1500, loserRating: 1000, kind: 'pet',
        });
        node_assert_1.strict.equal(r.delta, 8, 'favorite winning -> floor');
        node_assert_1.strict.equal(r.newRating, 1508);
        node_assert_1.strict.deepEqual(r.patch, { petRankedRating: 1508, petRankedWins: 11 });
        const loss = (0, _ranked_rating_js_1.creditRankedOutcome)({ petRankedRating: 1000, petRankedLosses: 4 }, {
            role: 'loser', winnerRating: 1500, loserRating: 1000, kind: 'pet',
        });
        node_assert_1.strict.deepEqual(loss.patch, { petRankedRating: 992, petRankedLosses: 5 });
    });
    (0, node_test_1.it)('winner gain magnitude equals loser loss magnitude (symmetric, same snapshot)', () => {
        // Ratings chosen well above the max delta so the loser never hits the 0 floor.
        for (const [w, l] of [[1000, 1000], [1200, 1000], [1000, 1300], [1800, 900]]) {
            const winner = (0, _ranked_rating_js_1.creditRankedOutcome)({ rankedRating: w }, { role: 'winner', winnerRating: w, loserRating: l, kind: 'player' });
            const loser = (0, _ranked_rating_js_1.creditRankedOutcome)({ rankedRating: l }, { role: 'loser', winnerRating: w, loserRating: l, kind: 'player' });
            node_assert_1.strict.equal(winner.delta, loser.delta, `delta symmetric for (${w},${l})`);
            node_assert_1.strict.equal(winner.newRating - w, winner.delta, `winner gains the delta for (${w},${l})`);
            node_assert_1.strict.equal(l - loser.newRating, loser.delta, `loser loses the delta for (${w},${l})`);
        }
    });
});
