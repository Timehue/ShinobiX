import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { rankedDelta, creditRankedOutcome, creditRankedFromSelf, DEFAULT_RANKED_RATING } from './_ranked-rating.js';

// Pins the server rating math to the client's formula
// (shinobij.client/src/lib/progression.ts rankedDelta) so moving the
// computation server-side is a ZERO behavior change. If the client formula ever
// changes, these expected values must change in lockstep — that's the point.

describe('rankedDelta (verbatim port of client progression.ts)', () => {
    it('gives 12 for an even match (K/2)', () => {
        assert.equal(rankedDelta(1000, 1000), 12);
    });

    it('floors a heavy favorite winning at 8', () => {
        assert.equal(rankedDelta(1200, 1000), 8);  // expected ~5.77 -> round 6 -> floor 8
        assert.equal(rankedDelta(1400, 1000), 8);  // expected ~2.18 -> round 2 -> floor 8
    });

    it('rewards an underdog upset with more than the floor', () => {
        assert.equal(rankedDelta(1000, 1200), 18); // ~18.23 -> 18
        assert.equal(rankedDelta(1000, 1400), 22); // ~21.82 -> 22
    });

    it('is never below the floor of 8', () => {
        for (let w = 800; w <= 2000; w += 137) {
            for (let l = 800; l <= 2000; l += 211) {
                assert.ok(rankedDelta(w, l) >= 8, `delta(${w},${l}) >= 8`);
            }
        }
    });
});

describe('creditRankedOutcome', () => {
    it('winner gains the delta and a win (player ladder)', () => {
        const r = creditRankedOutcome({ rankedRating: 1000, rankedWins: 3 }, {
            role: 'winner', winnerRating: 1000, loserRating: 1000, kind: 'player',
        });
        assert.equal(r.delta, 12);
        assert.equal(r.newRating, 1012);
        assert.deepEqual(r.patch, { rankedRating: 1012, rankedWins: 4 });
    });

    it('loser loses the same delta and a loss (player ladder)', () => {
        const r = creditRankedOutcome({ rankedRating: 1000, rankedLosses: 2 }, {
            role: 'loser', winnerRating: 1000, loserRating: 1000, kind: 'player',
        });
        assert.equal(r.delta, 12);
        assert.equal(r.newRating, 988);
        assert.deepEqual(r.patch, { rankedRating: 988, rankedLosses: 3 });
    });

    it('floors the loser rating at 0', () => {
        const r = creditRankedOutcome({ rankedRating: 5 }, {
            role: 'loser', winnerRating: 1000, loserRating: 5, kind: 'player',
        });
        assert.equal(r.newRating, 0, 'never goes negative');
        assert.equal(r.patch.rankedRating, 0);
        assert.equal(r.patch.rankedLosses, 1, 'losses initialised from 0');
    });

    it('defaults missing/garbage rating to 1000 and counters to 0', () => {
        const win = creditRankedOutcome({}, { role: 'winner', winnerRating: 1000, loserRating: 1000, kind: 'player' });
        assert.equal(win.newRating, DEFAULT_RANKED_RATING + 12);
        assert.deepEqual(win.patch, { rankedRating: 1012, rankedWins: 1 });

        const garbage = creditRankedOutcome({ rankedRating: 'oops' as unknown as number }, {
            role: 'winner', winnerRating: 1000, loserRating: 1000, kind: 'player',
        });
        assert.equal(garbage.newRating, 1012, 'NaN rating falls back to 1000');
    });

    it('uses the pet fields for the pet ladder', () => {
        const r = creditRankedOutcome({ petRankedRating: 1500, petRankedWins: 10 }, {
            role: 'winner', winnerRating: 1500, loserRating: 1000, kind: 'pet',
        });
        assert.equal(r.delta, 8, 'favorite winning -> floor');
        assert.equal(r.newRating, 1508);
        assert.deepEqual(r.patch, { petRankedRating: 1508, petRankedWins: 11 });

        const loss = creditRankedOutcome({ petRankedRating: 1000, petRankedLosses: 4 }, {
            role: 'loser', winnerRating: 1500, loserRating: 1000, kind: 'pet',
        });
        assert.deepEqual(loss.patch, { petRankedRating: 992, petRankedLosses: 5 });
    });

    it('winner gain magnitude equals loser loss magnitude (symmetric, same snapshot)', () => {
        // Ratings chosen well above the max delta so the loser never hits the 0 floor.
        for (const [w, l] of [[1000, 1000], [1200, 1000], [1000, 1300], [1800, 900]] as const) {
            const winner = creditRankedOutcome({ rankedRating: w }, { role: 'winner', winnerRating: w, loserRating: l, kind: 'player' });
            const loser = creditRankedOutcome({ rankedRating: l }, { role: 'loser', winnerRating: w, loserRating: l, kind: 'player' });
            assert.equal(winner.delta, loser.delta, `delta symmetric for (${w},${l})`);
            assert.equal(winner.newRating - w, winner.delta, `winner gains the delta for (${w},${l})`);
            assert.equal(l - loser.newRating, loser.delta, `loser loses the delta for (${w},${l})`);
        }
    });
});

describe('creditRankedFromSelf (verbatim port of client pet-ranked appliers)', () => {
    // Mirrors App.tsx ~14506-14528:
    //   win:  gain = rankedDelta(myRating, oppRating); petRankedRating += gain; petRankedWins  += 1
    //   loss: drop = rankedDelta(oppRating, myRating); petRankedRating  = max(0,-); petRankedLosses += 1
    it('even match win → +12 and a win (pet ladder)', () => {
        const r = creditRankedFromSelf({ petRankedRating: 1000, petRankedWins: 3 }, {
            outcome: 'win', opponentRating: 1000, kind: 'pet',
        });
        assert.equal(r.delta, 12);
        assert.equal(r.newRating, 1012);
        assert.deepEqual(r.patch, { petRankedRating: 1012, petRankedWins: 4 });
    });

    it('even match loss → -12 and a loss (pet ladder)', () => {
        const r = creditRankedFromSelf({ petRankedRating: 1000, petRankedLosses: 2 }, {
            outcome: 'loss', opponentRating: 1000, kind: 'pet',
        });
        assert.equal(r.delta, 12);
        assert.equal(r.newRating, 988);
        assert.deepEqual(r.patch, { petRankedRating: 988, petRankedLosses: 3 });
    });

    it('favorite winning floors the gain at 8; underdog winning gains more', () => {
        const fav = creditRankedFromSelf({ petRankedRating: 1500 }, { outcome: 'win', opponentRating: 1000, kind: 'pet' });
        assert.equal(fav.delta, 8);
        assert.equal(fav.newRating, 1508);
        const dog = creditRankedFromSelf({ petRankedRating: 1000 }, { outcome: 'win', opponentRating: 1200, kind: 'pet' });
        assert.equal(dog.delta, 18);
        assert.equal(dog.newRating, 1018);
    });

    it('losing to a favorite only drops the floor (8), matching client drop=rankedDelta(opp,me)', () => {
        // self 1000, opp 1500: drop = rankedDelta(1500, 1000) = 8 → 992
        const r = creditRankedFromSelf({ petRankedRating: 1000 }, { outcome: 'loss', opponentRating: 1500, kind: 'pet' });
        assert.equal(r.delta, 8);
        assert.equal(r.newRating, 992);
        assert.equal(r.patch.petRankedLosses, 1);
    });

    it('self-perspective equals the explicit winner/loser computation', () => {
        // win: I am the winner → winnerRating = my rating, loserRating = opp.
        const selfWin = creditRankedFromSelf({ rankedRating: 1100 }, { outcome: 'win', opponentRating: 950, kind: 'player' });
        const explicitWin = creditRankedOutcome({ rankedRating: 1100 }, { role: 'winner', winnerRating: 1100, loserRating: 950, kind: 'player' });
        assert.deepEqual(selfWin, explicitWin);
        // loss: opponent is the winner → winnerRating = opp, loserRating = my rating.
        const selfLoss = creditRankedFromSelf({ rankedRating: 1100 }, { outcome: 'loss', opponentRating: 950, kind: 'player' });
        const explicitLoss = creditRankedOutcome({ rankedRating: 1100 }, { role: 'loser', winnerRating: 950, loserRating: 1100, kind: 'player' });
        assert.deepEqual(selfLoss, explicitLoss);
    });

    it('defaults a missing/garbage self rating to 1000', () => {
        const win = creditRankedFromSelf({}, { outcome: 'win', opponentRating: 1000, kind: 'pet' });
        assert.equal(win.newRating, DEFAULT_RANKED_RATING + 12);
        assert.deepEqual(win.patch, { petRankedRating: 1012, petRankedWins: 1 });
    });

    it('floors a near-zero loser rating at 0', () => {
        const r = creditRankedFromSelf({ petRankedRating: 5 }, { outcome: 'loss', opponentRating: 1000, kind: 'pet' });
        assert.equal(r.newRating, 0);
        assert.equal(r.patch.petRankedRating, 0);
    });
});
