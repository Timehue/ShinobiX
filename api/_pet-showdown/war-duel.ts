/**
 * War pet duels on the Showdown engine — the shared resolver behind the
 * clan-war and sector-war pet win-conditions.
 *
 * Both modes are the same fight: two owners field pets, a server-minted seed
 * decides everything, no player is present when it resolves, and the client
 * only WATCHES. They used to run the legacy duel-sim mirror and have the client
 * re-run the identical function locally; on Showdown the server resolves
 * headlessly and hands the client the event log instead — there is no client
 * mirror to re-run, which is the point of a server-authoritative engine.
 *
 * PINNED PARAMETERS, inherited from the legacy CLAN_WAR_PET_DUEL contract and
 * kept for the same reasons:
 *   - GEAR APPLIES, CONSUMABLES DO NOT. Gear is the pet its owner built and
 *     fights exactly as in the live arena (main's items-on ruling). The
 *     consumable slot alone is stripped: an async fight has no settlement
 *     transaction, so a charge could never be honestly collected.
 *   - rewardEligible: false. War duels pay WAR consequences (chip/points),
 *     never the arena faucet.
 *   - tier 'warrior': the middle AI policy, matching the balance analyzer's
 *     reference configuration.
 *   - FORMAT 2v2 + 2 bench, fixed. See WAR_DUEL_FORMAT.
 *
 * TERRAIN → OPENING WEATHER. Sector war seals the defender sector's terrain
 * for the home-ground bonus (+10% to the matching element in the legacy sim —
 * a functional buff by owner ruling, not cosmetic). Showdown's native form of
 * "the environment favours an element" is WEATHER (boosts its own element
 * 1.18x, dampens its counter 0.88x), so the terrain arrives as the arena's
 * standing weather, sealed to outlast the judge's round cap. Two deliberate
 * consequences: the home ground is VISIBLE (the sky over the field is the
 * sector's climate), and a weather technique can contest it — the away team
 * can spend a turn turning the sky, which is a tactic, not a leak.
 *
 * DETERMINISM CONTRACT: same input → same verdict and same event log, forever.
 * The war record stores only the verdict; the watch endpoint re-derives the
 * log on demand from the same stored inputs (the Phase-0 replay doctrine:
 * store inputs, not fights). Anything time-based in here would break that.
 */

import { createShowdownSession, showdownStateView, WEATHER_NAME } from './engine.js';
import { resolveShowdownHeadless } from './headless.js';
import type { ShowdownFormat, ShowdownReplayScript } from '../../shared/pet-showdown-contract.js';
import { WAR_DUEL_FORMAT } from './war-team.js';
import type { Pet } from '../_pet-sim/pet-types.js';

export interface WarDuelInput {
    /** Deterministic label — derive it from the war/challenge ids, never a clock. */
    sessionId: string;
    seed: number;
    fromName: string;
    toName: string;
    fromPets: Pet[];
    toPets: Pet[];
    /** Sector-war home ground element (defender's sector), or null/undefined. */
    terrain?: string | null;
    /** War remains fixed at 2v2. A caller that has independently sealed a
     * one-pet encounter may explicitly request the truthful 1v1 field shape. */
    format?: ShowdownFormat;
}

export interface WarDuelResolution {
    /** Which side won. Showdown's judge always decides — war duels never draw. */
    outcome: 'from' | 'to';
    rounds: number;
    script: ShowdownReplayScript;
}

/** GEAR fights, CONSUMABLES stay home. Reconciled with main's items-on change:
 *  equipped PvP gear is part of the pet its owner built and applies exactly as
 *  it does in the live arena — but a consumable firing in an async garrison
 *  fight would be a benefit with no settlement transaction behind it (neither
 *  owner is present to authorize the charge), so that one slot is stripped
 *  before the seal arms it. */
function stripConsumable(pet: Pet): Pet {
    if (!pet.loadout) return pet;
    return { ...pet, loadout: { ...pet.loadout, consumable: undefined } };
}

/** Sector TERRAIN is a biome name; the home-ground element it favours is this
 *  table — the same mapping the legacy sim's terrainPetMult carried (volcano
 *  burns, snowfields run on meltwater, forests are Earth, the shadow sector
 *  hums with Lightning). Unknown or unset terrain is neutral: no weather. */
const TERRAIN_ELEMENT: Record<string, string> = {
    volcano: 'Fire', snow: 'Water', forest: 'Earth', shadow: 'Lightning',
};

/**
 * Resolve a war pet duel and produce its watchable script in one pass — the
 * outcome IS the script's final event, so computing one computes both.
 */
export function resolveWarDuel(input: WarDuelInput): WarDuelResolution {
    // ALWAYS 2v2 with a two-pet bench (owner ruling), never inferred from how
    // many pets happened to arrive. Sizing off the array made a war duel's
    // format an accident of the submission flow: one pet each meant 1v1 with no
    // reserves, so switching, forced rotation and trapping — core Showdown
    // tactics — did nothing in the modes that decide territory and rating. The
    // engine benches whatever exceeds the field, so a short roster still
    // fights; it just fights without reserves.
    const format = input.format ?? WAR_DUEL_FORMAT;
    const session = createShowdownSession({
        sessionId: input.sessionId,
        playerName: input.fromName,
        format,
        tier: 'warrior',
        seed: input.seed,
        playerPets: input.fromPets.map(stripConsumable),
        enemyPets: input.toPets.map(stripConsumable),
        enemyTeamName: input.toName,
        rewardEligible: false,
    });
    // Home ground: the sector's climate stands over the arena from round one.
    // `until` outlasts the judge's cap so it holds all fight unless a weather
    // technique overwrites it (newest setter wins — contesting the sky is play).
    const homeElement = input.terrain ? TERRAIN_ELEMENT[input.terrain] : undefined;
    if (homeElement && Object.prototype.hasOwnProperty.call(WEATHER_NAME, homeElement)) {
        session.weather = { element: homeElement, until: 999 };
    }
    // Snapshot BEFORE resolution, deep-copied: the view builder is not
    // guaranteed to return structurally independent objects, and the resolve
    // below mutates the session in place.
    const initialState = JSON.parse(JSON.stringify(showdownStateView(session))) as ShowdownReplayScript['initialState'];
    const { outcome, rounds, events } = resolveShowdownHeadless(session);
    const finalState = JSON.parse(JSON.stringify(showdownStateView(session))) as ShowdownReplayScript['finalState'];
    return {
        outcome: outcome === 'win' ? 'from' : 'to',
        rounds,
        script: { initialState, finalState, events },
    };
}
