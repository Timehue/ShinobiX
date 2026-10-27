import type { Character } from '../types/character';
import type { Pet } from '../types/pet';
import { activeCarriedPets } from './entitlements';
import { activeClientBreedingParentIds } from './pet-breeding';
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

/** Pet Arena fights with the player's real companions (owner ruling
 *  2026-10-26). The picker lists every carried pet; the reasons mirror the
 *  server's chooseArenaPets, which has the final word. */
export function arenaCarriedRoster(character?: Character): { pet: Pet; unavailable: string | null }[] {
    if (!character) return [];
    const breeding = activeClientBreedingParentIds(character);
    return activeCarriedPets(character).map(pet => ({ pet,
        unavailable: pet.expedition ? 'On expedition' : breeding.has(pet.id) ? 'In the hatchery' : null }));
}

/** A sealed Pet Arena fighter's id is the owner's pet id behind the seat
 *  prefix (`a:`/`b:`), so two players' same-id starters never collide. */
export function arenaPresentationPets(character: Character | undefined, seat: 'a' | 'b', fighters: readonly { id: string }[]): Pet[] {
    const owned = new Map((character?.pets ?? []).map(pet => [`${seat}:${pet.id}`, pet]));
    return fighters.flatMap(fighter => {
        const pet = owned.get(fighter.id);
        return pet ? [{ ...pet, id: fighter.id }] : [];
    });
}
