import { activeBreedingParentIds } from './_pet-busy.js';

/** The practice/Coliseum admission rule. Defense and active PvE assignments
 * do not lock this independent snapshot mode; do not borrow breeding's locks. */
export function showdownBusyIssue(
    character: Record<string, unknown>,
    pets: readonly { id: string; name: string; expedition?: { endsAt?: number } | null; training?: { endsAt?: number } | null }[],
    now = Date.now(),
): string | null {
    const breedingParents = activeBreedingParentIds(character, now);
    for (const pet of pets) {
        if (breedingParents.has(String(pet.id))) return `${pet.name} is in the Shinobi Hatchery.`;
        if (pet.expedition && Number(pet.expedition.endsAt ?? 0) > now) return `${pet.name} is away on an expedition.`;
        if (pet.training && Number(pet.training.endsAt ?? 0) > now) return `${pet.name} is mid-training.`;
    }
    return null;
}
