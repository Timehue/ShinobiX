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

/** True when the account can actually field a ranked pet right now. */
export function hasRankedReadyPet(save: Record<string, unknown> | null): boolean {
    const character = (save?.character ?? null) as Record<string, unknown> | null;
    return !!character && selectRankedPet(character) !== null;
}
