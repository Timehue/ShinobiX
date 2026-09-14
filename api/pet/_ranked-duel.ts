/*
 * THE RANKED PET DUEL — one fight, one engine, one answer.
 *
 * The ranked pet queue used to resolve twice, differently:
 *
 *   - the SERVER rated the match by running `runPetDuel` (the legacy plain duel
 *     sim) over the match token's sealed pets and the token's own seed;
 *   - the CLIENT showed the player `runPetDuelCinematic` (a DIFFERENT engine)
 *     over `petBattleSeed`, a clock-derived number the challenger generated and
 *     shipped inside the challenge — a DIFFERENT seed.
 *
 * Two engines, two seeds, one rating. What a player watched had no reliable
 * relationship to what their Elo did; a convincing victory could be recorded as
 * a loss, and neither side could tell the difference from a normal outcome.
 *
 * This module is the single resolution. It is a PURE function of the match
 * token, which is what makes the fix hold together:
 *
 *   - `api/pet/battle-result.ts` derives the winner from it (and re-derives it a
 *     second time as a determinism cross-check against the settlement intent);
 *   - `api/pet/ranked-watch.ts` re-derives the SAME call to hand both players
 *     the event log to watch.
 *
 * So the fight on screen is not a reconstruction of the rated fight — it is the
 * rated fight, replayed from the same inputs. Nothing is stored: the replay
 * doctrine here is "store inputs, not fights", and the token IS the input.
 *
 * FORMAT IS 1v1. A ranked match token seals exactly one pet per side, so the
 * 2v2-plus-bench war format would put two lone pets in a shape built for
 * reserves and switch play. See WarDuelInput.format.
 *
 * DETERMINISM: nothing here may read a clock, a save, or a random source. Two
 * calls with the same token must produce byte-identical scripts forever, or the
 * settle-time cross-check starts rejecting honest matches.
 */

import { resolveWarDuel } from '../_pet-showdown/war-duel.js';
import type { ShowdownEvent, ShowdownReplayScript, ShowdownStateView } from '../../shared/pet-showdown-contract.js';
import type { Pet } from '../_pet-sim/pet-types.js';
import type { RankedPetMatchToken } from './_ranked-authority.js';

export interface RankedPetDuelResolution {
    /** The winner's account name. Showdown's judge always decides, so a ranked
     *  pet duel no longer draws — the `null` the settlement path still handles
     *  is history from the retired engine. */
    winnerName: string;
    script: ShowdownReplayScript;
}

/**
 * Resolve a ranked pet match from its sealed token.
 *
 * Canonical ordering by account name (not by who happened to initiate) so the
 * fight is identical no matter which participant asks for it — the same reason
 * the retired path ordered its arguments that way.
 */
export function resolveRankedPetDuel(token: RankedPetMatchToken): RankedPetDuelResolution {
    const aIsCanonical = token.a <= token.b;
    const fromName = aIsCanonical ? token.a : token.b;
    const toName = aIsCanonical ? token.b : token.a;
    const fromPet = (aIsCanonical ? token.aPet : token.bPet) as unknown as Pet;
    const toPet = (aIsCanonical ? token.bPet : token.aPet) as unknown as Pet;
    const { outcome, script } = resolveWarDuel({
        // Derived from the pair id, never a clock — the session id feeds the
        // arena/stage pick, so a wall-clock label would restage the same fight
        // differently on every watch.
        sessionId: `pet-ranked:${token.pairId}`,
        seed: token.seed,
        fromName,
        toName,
        fromPets: [fromPet],
        toPets: [toPet],
        format: '1v1',
    });
    return { winnerName: outcome === 'from' ? fromName : toName, script };
}

/** Change only presentation coordinates; the seeded fight stays canonical. */
export function rankedPetReplayForViewer(token: RankedPetMatchToken, script: ShowdownReplayScript, viewer: string): ShowdownReplayScript {
    const canonicalPlayer = token.a <= token.b ? token.a : token.b;
    if (viewer === canonicalPlayer || (viewer !== token.a && viewer !== token.b)) return script;
    const side = (value: 'player' | 'enemy') => value === 'player' ? 'enemy' as const : 'player' as const;
    const state = (view: ShowdownStateView): ShowdownStateView => ({
        ...view,
        player: view.enemy,
        enemy: view.player,
        enemyTeamName: canonicalPlayer,
        outcome: view.outcome === null ? null : view.outcome === 'win' ? 'loss' : 'win',
    });
    const event = (entry: ShowdownEvent): ShowdownEvent => {
        switch (entry.t) {
            case 'action': case 'skip': case 'confused': return { ...entry, actorSide: side(entry.actorSide) };
            case 'consumable': case 'switch': return { ...entry, side: side(entry.side) };
            case 'dot': return { ...entry, targetSide: side(entry.targetSide) };
            case 'end': return { ...entry, outcome: entry.outcome === 'win' ? 'loss' : 'win' };
            case 'roundStart': case 'roundEnd': return entry;
            default: { const exhaustive: never = entry; return exhaustive; }
        }
    };
    return { initialState: state(script.initialState), finalState: state(script.finalState), events: script.events.map(event) };
}
