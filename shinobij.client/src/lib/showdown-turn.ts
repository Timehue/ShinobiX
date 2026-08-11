/*
 * Who the command deck may ask for an order.
 *
 * Extracted from PetShowdownBattle so it can be tested: living inline, its
 * empty-result case produced an unrecoverable soft-lock (blank command bar, no
 * way to advance the round, Forfeit the only remaining control) and no test
 * could see it, because the filter was a local const in a 2,300-line component.
 */
import type { ShowdownPetView } from "../../../shared/pet-showdown-contract";

/** The pets the deck should prompt this round.
 *
 *  A pet that will lose its next action is not asked for one — it used to get
 *  the full deck for a command the engine discards before ever reading it. A
 *  STUNNED pet is still prompted, because it may still rotate out; an
 *  overdraft-WINDED pet may not rotate away, so it is skipped entirely.
 *
 *  This can legitimately return EMPTY — every living pet winded, or stunned
 *  with no bench — and callers MUST handle that by resolving the round rather
 *  than waiting for an order that can never be given. */
export function promptablePets(
    living: readonly ShowdownPetView[],
    livingBenchCount: number,
): ShowdownPetView[] {
    return living.filter(
        (p) => !p.skipsNextAction || (p.canSwitchOut && livingBenchCount > 0),
    );
}
