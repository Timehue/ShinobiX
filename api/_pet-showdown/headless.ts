/**
 * Headless Showdown resolution — a whole match played to a verdict with no
 * player, no endpoint, and no clock.
 *
 * WHY THIS EXISTS. The live path resolves ONE round per request: the endpoint
 * takes the player's orders, asks the AI for the enemy's, and calls
 * `resolveShowdownRound`. Three callers need the whole match instead:
 *
 *   1. Clan War pet duels, which auto-resolve from `(pets, seed)` with no
 *      player present and no commands sent from the client.
 *   2. The engine-comparison harness, which plays thousands of matchups
 *      offline to measure how a port moves each mode's win rates.
 *   3. Any future mode that wants a decided fight it can replay later, since
 *      the event log this returns IS the replay.
 *
 * DETERMINISM IS THE CONTRACT. Same session in, same verdict out, always. The
 * only entropy is the session's own seeded PRNG, and the two AI calls happen in
 * a FIXED order every round (player side, then enemy side) so the draw sequence
 * is reproducible. Callers that must re-derive a verdict later — clan war
 * settlement, replay validation — depend on this and nothing else.
 *
 * It is NOT the live path with the player stubbed out: a live round interleaves
 * one AI call with the player's real orders, so the PRNG stream necessarily
 * differs. Headless is its own scenario, internally consistent.
 */

import { chooseShowdownAiCommands } from './ai.js';
import { resolveShowdownRound, type ShowdownSession } from './engine.js';
import type { ShowdownEvent, ShowdownOutcome } from '../../shared/pet-showdown-contract.js';

/** Hard ceiling on the round loop. The engine's own judge ends a match at
 *  SHOWDOWN_TURN_CAP, so this can only fire if the engine ever stopped
 *  finishing — a bug we want surfaced as a thrown error, not an infinite
 *  loop in a request handler. Deliberately far above the cap. */
const HEADLESS_ROUND_CEILING = 200;

export interface HeadlessResult {
    /** The verdict from the PLAYER side's point of view, matching the session's
     *  own `outcome` convention (the caller decides what "player" means when
     *  both sides are AI). */
    outcome: ShowdownOutcome;
    /** Rounds actually played. */
    rounds: number;
    /** The full event log, in order — playable as a replay. */
    events: ShowdownEvent[];
}

/**
 * Play `session` to a verdict, mutating it in place (same as the live path).
 *
 * Pass an already-finished session and you get its outcome with an empty log,
 * which makes this safe to call on a retry.
 */
export function resolveShowdownHeadless(session: ShowdownSession): HeadlessResult {
    const events: ShowdownEvent[] = [];
    let rounds = 0;

    while (!session.finished) {
        if (rounds >= HEADLESS_ROUND_CEILING) {
            throw new Error(
                `resolveShowdownHeadless: no verdict after ${HEADLESS_ROUND_CEILING} rounds — the engine judge did not fire`,
            );
        }
        // FIXED ORDER, load-bearing: both calls draw from the session PRNG, so
        // swapping them changes every downstream roll and therefore the verdict.
        const playerCommands = chooseShowdownAiCommands(session, 'player');
        const enemyCommands = chooseShowdownAiCommands(session, 'enemy');
        events.push(...resolveShowdownRound(session, playerCommands, enemyCommands));
        rounds += 1;
    }

    if (!session.outcome) {
        // A finished session always carries an outcome. Defaulting one here
        // would hand clan-war settlement a fabricated verdict, so this fails
        // loudly instead.
        throw new Error('resolveShowdownHeadless: session finished with no outcome');
    }
    return { outcome: session.outcome, rounds, events };
}
