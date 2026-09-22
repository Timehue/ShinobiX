/*
 * Ranked pet eligibility — one definition shared by the queue and the start.
 *
 * Extracted verbatim from api/pet/ranked-start.ts so matchmaking cannot admit a
 * fighter that /api/pet/ranked-start would then refuse. A queue that pairs two
 * players on looser rules than the mint burns the pairing and strands both.
 */
import { activeCarriedPets } from '../_entitlements.js';
import { DEFAULT_RANKED_RATING } from '../_ranked-rating.js';
import { activeBreedingParentIds } from './_pet-busy.js';

export function petRatingOf(save: Record<string, unknown> | null): number {
    const character = (save?.character ?? null) as Record<string, unknown> | null;
    const rating = Number(character?.petRankedRating);
    return Number.isFinite(rating) ? rating : DEFAULT_RANKED_RATING;
}

export function rankedPetUnavailable(
    character: Record<string, unknown>,
    pet: Record<string, unknown>,
): boolean {
    const id = String(pet.id ?? '');
    return !id
        || activeBreedingParentIds(character).has(id)
        || !!pet.training
        || !!pet.expedition;
}

export function selectRankedPet(
    character: Record<string, unknown>,
    requestedId = '',
): Record<string, unknown> | null {
    const pets = activeCarriedPets<Record<string, unknown>>(character);
    const requested = requestedId ? pets.find((pet) => String(pet?.id ?? '') === requestedId) : undefined;
    const active = pets.find((pet) => String(pet?.id ?? '') === String(character.activePetId ?? ''));
    const selected = requested ?? active ?? pets.find((pet) => !rankedPetUnavailable(character, pet));
    return selected && !rankedPetUnavailable(character, selected) ? selected : null;
}

/** The first two pets enter together; the next two are rotating reserves. */
export function selectRankedTeam(character: Record<string, unknown>, requestedIds?: readonly string[]): Record<string, unknown>[] | null {
    const pets = activeCarriedPets<Record<string, unknown>>(character);
    const ready = pets.filter((pet) => !rankedPetUnavailable(character, pet));
    if (requestedIds) {
        if (requestedIds.length !== 4 || new Set(requestedIds).size !== 4) return null;
        const selected = requestedIds.map((id) => ready.find((pet) => String(pet.id) === id));
        return selected.every((pet): pet is Record<string, unknown> => !!pet) ? selected as Record<string, unknown>[] : null;
    }
    const ordered = [
        ...ready.filter((pet) => String(pet.id ?? '') === String(character.activePetId ?? '')),
        ...ready.filter((pet) => String(pet.id ?? '') !== String(character.activePetId ?? '')),
    ];
    const unique = [...new Map(ordered.map((pet) => [String(pet.id), pet])).values()];
    return unique.length >= 4 ? unique.slice(0, 4) : null;
}

/** True when the account can actually field a ranked pet right now. */
export function hasRankedReadyPet(save: Record<string, unknown> | null): boolean {
    const character = (save?.character ?? null) as Record<string, unknown> | null;
    return !!character && selectRankedPet(character) !== null;
}
