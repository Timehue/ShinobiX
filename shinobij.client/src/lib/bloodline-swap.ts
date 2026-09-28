/*
 * Pure custom-bloodline equip transition.
 *
 * A character may store multiple bloodlines but carries one at a time. A swap
 * removes every inactive bloodline's techniques from the loadout. Mastery is
 * durable training progress: it survives swaps and edits so equipping the old
 * bloodline again restores that progress instead of silently resetting it.
 */

import type { Character } from "../types/character";
import type { SavedBloodline } from "../types/combat";
import { starterSavedBloodlines } from "../data/jutsu";

export function replaceCharacterBloodline(
    character: Character,
    newBloodline: SavedBloodline,
    savedBloodlines: SavedBloodline[],
): Character {
    const incomingJutsuIds = new Set(newBloodline.jutsus.map((jutsu) => jutsu.id));
    const bloodlineJutsuIds = new Set(
        [...starterSavedBloodlines, ...savedBloodlines]
            .flatMap((bloodline) => bloodline.jutsus.map((jutsu) => jutsu.id)),
    );

    return {
        ...character,
        equippedBloodlineId: newBloodline.id,
        equippedJutsuIds: character.equippedJutsuIds.filter((id) =>
            !bloodlineJutsuIds.has(id) || incomingJutsuIds.has(id)),
        // Deliberately preserve every mastery row. Stored-but-unequipped custom
        // techniques are still rejected by the client/server bloodline gates;
        // retaining the row only preserves earned progress for a later swap.
        jutsuMastery: [...(character.jutsuMastery ?? [])],
    };
}
