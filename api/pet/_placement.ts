import { maxPets } from '../_entitlements.js';

export type PetAcquisitionDestination = 'roster' | 'sanctuary';

/** The carried roster remains the battle-selection boundary. Ownership does not. */
export function petAcquisitionDestination(character: Record<string, unknown>): PetAcquisitionDestination {
    const pets = Array.isArray(character.pets) ? character.pets : [];
    return pets.length < maxPets(character) ? 'roster' : 'sanctuary';
}
