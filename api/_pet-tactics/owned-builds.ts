import { activeCarriedPets } from '../_entitlements.js';
import { rankedPetUnavailable } from '../pet/_ranked-eligibility.js';
import { ownedTacticsSpeciesId } from '../../shared/pet-tactics-roster.js';
import { TacticsError, validateBuilds } from './engine.js';

/** Bind each competitive build to a distinct available pet in the server save. */
export function validateOwnedRankedBuilds(character: Record<string, unknown>, value: unknown) {
    const builds = validateBuilds(value);
    const carried = activeCarriedPets<Record<string, unknown>>(character);
    const seen = new Set<string>();
    return builds.map(build => {
        const pet = carried.find(p => String(p.id) === build.ownedPetId);
        if (!pet || !build.ownedPetId || seen.has(build.ownedPetId) || rankedPetUnavailable(character, pet)) {
            throw new TacticsError('Choose four different available pets you are carrying. Pets in Sanctuary, breeding or on expedition cannot enter ranked.');
        }
        if (ownedTacticsSpeciesId(pet) !== build.speciesId) throw new TacticsError('Your pet’s form has changed. Rebuild your ranked squad.');
        seen.add(build.ownedPetId);
        return build;
    });
}
