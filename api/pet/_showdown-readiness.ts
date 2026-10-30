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
        // Any expedition, finished or not, until it is collected: the same rule
        // as Pet Arena, the Ladder and Warfront (petCombatBusyReason), and the
        // combat seal drops a pet still holding one (combat-core/companion.ts).
        if (pet.expedition) {
            return Number(pet.expedition.endsAt ?? 0) > now
                ? `${pet.name} is away on an expedition.`
                : `${pet.name} is back from an expedition. Collect it before battling.`;
        }
    }
    return null;
}
