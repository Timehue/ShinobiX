/*
 * Pure custom-bloodline equip transition.
 *
 * A character always keeps their starter bloodline and may carry one equipped
 * custom bloodline. Swapping the custom slot therefore removes only techniques
 * that belonged exclusively to the outgoing custom bloodline. Mastery is
 * durable training progress: it survives swaps and edits so equipping the old
 * bloodline again restores that progress instead of silently resetting it.
 */

import type { Character } from "../types/character";
import type { SavedBloodline } from "../types/combat";

export function replaceCharacterBloodline(
    character: Character,
    newBloodline: SavedBloodline,
    savedBloodlines: SavedBloodline[],
): Character {
    const previousCustom = savedBloodlines.find((bloodline) => bloodline.id === character.equippedBloodlineId);
    const incomingJutsuIds = new Set(newBloodline.jutsus.map((jutsu) => jutsu.id));
    const outgoingJutsuIds = new Set(
        (previousCustom?.jutsus ?? [])
            .map((jutsu) => jutsu.id)
            // Editing the currently equipped bloodline keeps unchanged buttons
            // in place; only definitions removed by the edit leave the loadout.
            .filter((id) => previousCustom?.id !== newBloodline.id || !incomingJutsuIds.has(id)),
    );

    return {
        ...character,
        equippedBloodlineId: newBloodline.id,
        equippedJutsuIds: character.equippedJutsuIds.filter((id) => !outgoingJutsuIds.has(id)),
        // Deliberately preserve every mastery row. Stored-but-unequipped custom
        // techniques are still rejected by the client/server bloodline gates;
        // retaining the row only preserves earned progress for a later swap.
        jutsuMastery: [...(character.jutsuMastery ?? [])],
    };
}
