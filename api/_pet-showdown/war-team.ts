/**
 * Sealing a WAR TEAM — the roster an asynchronous pet duel fields.
 *
 * Owner ruling: sector war, clan war and ranked are all **2v2 with a 2-pet
 * bench**, the same shape as every other Showdown format. They used to send a
 * single pet each, which meant the modes that decide territory and rating were
 * the only ones in the game where switching, forced rotation and trapping did
 * nothing at all.
 *
 * WHERE THE OTHER PETS COME FROM. The player still CHOOSES the pet(s) they lead
 * with — that choice is the whole ritual of sending a champion — and the rest of
 * the team fills out from their own carried roster, best first. Nobody has to
 * re-pick four pets in three different screens, and a team is always legal:
 * exactly what the owner already has, never an invented pet.
 *
 * A roster shorter than the full team is fielded as-is. The engine benches
 * whatever exceeds the field size, so a player with two pets brings two and
 * fights without reserves rather than being refused the match.
 */

import { kv } from '../_storage.js';
import { activeCarriedPets } from '../_entitlements.js';
import { petCombatBusyReason } from '../pet/_pet-busy.js';
import { petStatCeil, type PetCeilStat } from '../_pet-stat-ceil.js';
import { SHOWDOWN_BENCH_SIZE, SHOWDOWN_FORMAT_SIZE } from '../../shared/pet-showdown-contract.js';
import type { Pet } from '../_pet-sim/pet-types.js';

const CEIL_STATS: PetCeilStat[] = ['hp', 'attack', 'defense', 'speed'];

/** Field + bench for an asynchronous war duel: 2v2 with two in reserve. */
export const WAR_DUEL_FORMAT = '2v2' as const;
export const WAR_TEAM_SIZE = SHOWDOWN_FORMAT_SIZE[WAR_DUEL_FORMAT] + SHOWDOWN_BENCH_SIZE;

/** Clamp a stored pet's stats to its rarity ceiling — the same guard the
 *  single-pet sealers applied, kept so a tampered save cannot field a giant. */
function clampToCeiling(raw: Record<string, unknown>): Pet {
    const pet = { ...raw } as unknown as Pet;
    for (const stat of CEIL_STATS) {
        const v = Number(raw[stat]) || 0;
        (pet as unknown as Record<string, number>)[stat] = Math.min(v, petStatCeil(raw.rarity as string, stat));
    }
    return pet;
}

/**
 * Seal a war team from a player's save.
 *
 * `leadPetIds` are the pets the player explicitly sent, in order; the roster
 * fills the rest. Pets that are busy (expedition, another battle) are skipped
 * entirely — including as leads, matching the old single-pet behaviour, which
 * refused a busy champion rather than fielding it.
 *
 * Returns null only when the player has NO eligible pet at all.
 */
export async function sealWarTeam(playerName: string, leadPetIds: readonly string[] = []): Promise<Pet[] | null> {
    const save = await kv.get<{ character?: { pets?: unknown[]; activePetId?: string } }>(`save:${playerName.toLowerCase()}`);
    return buildWarTeam((save?.character ?? {}) as Record<string, unknown>, leadPetIds);
}

/**
 * The pure half of sealWarTeam: pick the team from a character record already
 * in hand. Ranked resolves synchronously from both players' characters, so it
 * needs the selection without the storage read — and both paths MUST pick the
 * same way, which is why there is one implementation.
 */
export function buildWarTeam(character: Record<string, unknown>, leadPetIds: readonly string[] = []): Pet[] | null {
    const roster = activeCarriedPets<Record<string, unknown>>(character);
    if (!roster.length) return null;

    const eligible = roster.filter((p) => !petCombatBusyReason(character, p));
    if (!eligible.length) return null;

    const chosen: Record<string, unknown>[] = [];
    const taken = new Set<string>();
    const take = (p: Record<string, unknown> | undefined) => {
        if (!p) return;
        const id = String(p.id ?? '');
        if (!id || taken.has(id) || chosen.length >= WAR_TEAM_SIZE) return;
        taken.add(id);
        chosen.push(p);
    };

    // 1. The pets the player actually sent, in the order they sent them.
    for (const id of leadPetIds) take(eligible.find((p) => String(p.id) === String(id)));
    // 2. Their active companion, if it is not already in.
    take(eligible.find((p) => String(p.id) === String(character.activePetId ?? '')));
    // 3. Fill from the roster in its own order — the player's arrangement.
    for (const p of eligible) take(p);

    return chosen.map(clampToCeiling);
}
