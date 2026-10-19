import { resolvePetAbilityProgression, type AuthoredPetAbility, type PetAbilityUpgrade } from '../../../shared/pet-ability-progression';
import { petBattleTechniques } from '../../../shared/pet-battle-loadout';
import { rankedBuildForPet } from '../../../shared/pet-tactics-build';
import { TACTICS_MOVES, tacticsSpecies } from '../../../shared/pet-tactics-roster';
import type { Pet } from '../types/pet';

export const PET_MASTERY_LABELS: Record<PetAbilityUpgrade, string> = {
    'utility-mastery': 'Utility mastery',
    'offense-mastery': 'Advanced mastery',
    'signature-mastery': 'Signature mastery',
};

/** Presentation uses the same eligibility/default resolver as battle admission.
 * Reading a preview must never replace a saved, currently locked preference. */
export function petProgressionPresentation(pet: Pet) {
    const build = pet.rankedBuild && rankedBuildForPet(pet);
    const species = build && tacticsSpecies(build.speciesId);
    const selected = build?.moveIds ?? [];
    const progression = resolvePetAbilityProgression<AuthoredPetAbility>({ ...pet,
        ...(species ? { abilitySource: 'tactics' as const,
            abilities: [...species.pool.map(id => TACTICS_MOVES[id]), species.signature] } : { abilities: pet.jutsus }),
    });
    const active = species ? petBattleTechniques(pet, { forceProgression: true }) ?? [] : progression.abilities;
    return { ...progression, active, savedLocked: progression.allAbilities.filter(move =>
        !move.upgrade && move.unlockLevel > progression.level && selected.includes(String(move.id))),
    };
}
