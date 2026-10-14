import type { Character } from '../types/character';
import { activeCarriedPets } from './entitlements';
import { activeClientBreedingParentIds } from './pet-breeding';
import { tacticsSpecies } from '../../../shared/pet-tactics-roster';
import { rankedBuildForPet } from '../../../shared/pet-tactics-build';
import type { TacticsPetSheet } from '../../../shared/pet-tactics-contract';

export function rankedBattlePresentationPets(character: Character | undefined,
    fighters: readonly Pick<TacticsPetSheet, 'id' | 'speciesId' | 'ownedPetId'>[]) {
    const ownedById = new Map((character?.pets ?? []).map(p => [p.id, p]));
    return fighters.flatMap(fighter => {
        const owned = fighter.ownedPetId ? ownedById.get(fighter.ownedPetId) : undefined;
        // The battle actor id is different from the persistent instance id.
        // Carry the sealed species explicitly, including evolved starter art,
        // so legacy pets without templateId do not lose their model here.
        return owned ? [{ ...owned, id: fighter.id, templateId: fighter.speciesId }] : [];
    });
}

export function rankedCarriedRoster(character?: Character) {
    if (!character) return [];
    const breeding = activeClientBreedingParentIds(character);
    return activeCarriedPets(character).flatMap(pet => {
        const build = rankedBuildForPet(pet);
        if (!build) return [];
        const species = tacticsSpecies(build.speciesId)!;
        return [{ ...species, key: pet.id, name: pet.nickname || pet.name || species.name,
            unavailable: pet.expedition ? 'On expedition' : breeding.has(pet.id) ? 'In the hatchery' : null,
            build }];
    });
}
