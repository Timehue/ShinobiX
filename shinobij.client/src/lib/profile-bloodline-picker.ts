/*
 * Profile "Build" dossier bloodline picker — a Shinobi Supporter perk.
 *
 * Supporters may switch their active bloodline straight from the Profile
 * instead of opening the Bloodline Maker archive. Only owned bloodlines are
 * offered (the original starter plus stored custom ones): that is the set the
 * save endpoint accepts as an explicit equip intent. The swap itself is the
 * archive's own path (equipOwnedBloodline + the authoritative bloodline save).
 */

import { getCharacterBloodlines, getOwnedBloodlines } from "./bloodline";
import { isPatreonSubscriber } from "./entitlements";
import type { Character } from "../types/character";
import type { SavedBloodline } from "../types/combat";

/**
 * The picker's options, or null when the picker is not shown: the character is
 * not an active supporter, or there is nothing to switch to. The active
 * bloodline is always listed so the control can display it, even in the rare
 * case it is a legacy built-in outside the owned set.
 */
export function profileBloodlinePickerChoices(
    character: Pick<Character, "bloodline" | "equippedBloodlineId" | "patreon">,
    savedBloodlines: SavedBloodline[],
): SavedBloodline[] | null {
    if (!isPatreonSubscriber(character)) return null;
    const owned = getOwnedBloodlines(character, savedBloodlines);
    const active = getCharacterBloodlines(character, savedBloodlines)[0];
    const choices = active && !owned.some((bloodline) => bloodline.id === active.id) ? [active, ...owned] : owned;
    return choices.length > 1 ? choices : null;
}
