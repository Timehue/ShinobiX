"use strict";
/*
 * Server-side ranked-rating math — audit #7 / Stage 3, Phase 0.
 *
 * This is the pure, IO-free core that lets the SERVER own the ranked Elo
 * outcome instead of trusting the client to compute and self-apply it (today
 * the client computes the delta in `shinobij.client/src/lib/progression.ts`
 * and writes it through the save blob, gated only by a ±200/save clamp).
 *
 * `rankedDelta` is a VERBATIM port of the client formula
 * (`progression.ts:44-47`) — it MUST stay byte-for-byte equivalent so moving
 * the computation server-side changes nothing about the numbers (hard rule: no
 * balance change). `_ranked-rating.test.ts` pins the exact outputs.
 *
 * `creditRankedOutcome` mirrors how the client applies that delta in App.tsx's
 * battle-end handlers: winner gains the delta + a win, loser loses the same
 * amount (floored at 0) + a loss. The PET ranked ladder uses the identical
 * formula on the `petRankedRating` / `petRankedWins` / `petRankedLosses` fields.
 *
 * No KV, no locks here — the eventual claim-rewards wiring (Phase 1) supplies
 * the authoritative pre-match ratings (snapshotted on the PvpSession) + the
 * server-verified winner, then persists the returned patch under the player's
 * save lock with the existing NX claim receipt for exactly-once crediting.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_RANKED_RATING = void 0;
exports.rankedDelta = rankedDelta;
exports.creditRankedOutcome = creditRankedOutcome;
/** Default Elo for a character that has never been rated (matches the client's `?? 1000`). */
exports.DEFAULT_RANKED_RATING = 1000;
const FIELDS = {
    player: { rating: 'rankedRating', wins: 'rankedWins', losses: 'rankedLosses' },
    pet: { rating: 'petRankedRating', wins: 'petRankedWins', losses: 'petRankedLosses' },
};
/**
 * Standard Elo delta — the amount the winner gains (the loser loses the same).
 * VERBATIM port of `shinobij.client/src/lib/progression.ts` rankedDelta:
 * K-factor 24, divisor 400, floor 8, rounded to an integer.
 */
function rankedDelta(winnerRating, loserRating) {
    const expected = 1 / (1 + Math.pow(10, (loserRating - winnerRating) / 400));
    return Math.max(8, Math.round(24 * (1 - expected)));
}
function toNumber(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}
/**
 * Compute the server-authoritative rating patch for ONE participant.
 *
 * Both sides are computed from the SAME pre-match snapshot
 * (`winnerRating`/`loserRating`), so the winner's gain and the loser's loss are
 * symmetric regardless of which client claims first. Mirrors the client exactly:
 *   winner: rating += delta,        wins   += 1
 *   loser:  rating  = max(0, r-d),  losses += 1
 *
 * @param char        the participant's current character fields (read-only)
 * @param role        whether THIS participant won or lost
 * @param winnerRating pre-match rating of the match winner
 * @param loserRating  pre-match rating of the match loser
 * @param kind        'player' (rankedRating) or 'pet' (petRankedRating)
 */
function creditRankedOutcome(char, opts) {
    const { role, winnerRating, loserRating, kind } = opts;
    const fields = FIELDS[kind];
    const delta = rankedDelta(winnerRating, loserRating);
    const current = toNumber(char[fields.rating], exports.DEFAULT_RANKED_RATING);
    if (role === 'winner') {
        const newRating = current + delta;
        const wins = Math.max(0, Math.floor(toNumber(char[fields.wins], 0)));
        return { patch: { [fields.rating]: newRating, [fields.wins]: wins + 1 }, newRating, delta };
    }
    const newRating = Math.max(0, current - delta);
    const losses = Math.max(0, Math.floor(toNumber(char[fields.losses], 0)));
    return { patch: { [fields.rating]: newRating, [fields.losses]: losses + 1 }, newRating, delta };
}
