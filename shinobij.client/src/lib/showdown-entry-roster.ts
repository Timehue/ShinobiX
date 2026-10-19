import type { ShowdownStateView } from '../../../shared/pet-showdown-contract';
import type { Pet } from '../types/pet';
import type { Character } from '../types/character';

/** Admission may recover an existing paid session instead of the lobby request.
 * Resume pointers and model warming must follow the server-sealed roster. */
export function showdownEntryRoster(state: Pick<ShowdownStateView, 'player'>, owned: readonly Pet[]) {
    const petIds = state.player.map(pet => pet.id);
    const ownedById = new Map(owned.map(pet => [pet.id, pet]));
    return { petIds, pets: petIds.map(id => ownedById.get(id)).filter((pet): pet is Pet => Boolean(pet)) };
}

/** Use the versioned commit gate for admission spends. A stale snapshot must
 * never fall through to an unversioned update of newer local state. */
export function adoptShowdownEntrySnapshot(entry: { character?: unknown; saveVersion?: number }, commit?: (next: Character, version: number) => boolean): boolean {
    if (!commit || !entry.character || !Number.isSafeInteger(entry.saveVersion)) return false;
    return commit(entry.character as Character, entry.saveVersion!);
}
