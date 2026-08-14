import type { Pet } from "../types/pet";

/**
 * Removes the single-use battle item from only the pets that entered a duel.
 *
 * Callers must pass the freshest pet array they have (normally the authoritative
 * settlement character, otherwise the current functional-state value). Mapping
 * that base preserves server-owned pet fields added by the settlement.
 */
export function clearPetBattleConsumables(pets: readonly Pet[], petIds: readonly string[]): Pet[] {
  const spentPetIds = new Set(petIds);
  return pets.map((pet) => spentPetIds.has(pet.id) && pet.loadout?.consumable
    ? { ...pet, loadout: { ...pet.loadout, consumable: undefined } }
    : pet);
}
