/*
 * Bloodline lookup + access-control helpers.
 *
 * Pure functions that answer "does this character have access to this
 * jutsu via a bloodline?" + "which bloodlines is this character carrying
 * right now?" + the swap-bloodline character mutation.
 *
 *   • getCharacterBloodlines      — the single active bloodline
 *   • isBloodlineSpecialElementJutsu — is `jutsu` granted by an equipped
 *                                     bloodline's special element?
 *   • isBloodlineJutsu            — is `jutsu` in any equipped bloodline?
 *   • canEquipElementJutsu        — full equip-access check
 *   • replaceCharacterBloodline   — custom-slot transition (re-exported from
 *                                    the pure bloodline-swap module)
 *
 * starterSavedBloodlines comes straight from ../data/jutsu, where it is defined.
 * This used to read it back from "../App" on the belief that the starter list
 * lived there; it does not — App imports it from data/jutsu too, so the detour
 * only dragged App's component/CSS graph into every consumer of this file.
 *
 * Extracted from App.tsx.
 */

import { starterSavedBloodlines } from "../data/jutsu";
import { hasCharacterElement } from "./elements";
import type { Character } from "../types/character";
import type { Jutsu, SavedBloodline } from "../types/combat";
export { replaceCharacterBloodline } from "./bloodline-swap";

/**
 * Return the selected bloodline. The original starter is active only until a
 * stored or built-in bloodline is explicitly equipped.
 */
export function getCharacterBloodlines(
    character: Pick<Character, "bloodline" | "equippedBloodlineId">,
    savedBloodlines: SavedBloodline[],
): SavedBloodline[] {
    const starterBloodlineName = character.bloodline === "Blue Blade Eyes" ? "Ashen Eyes" : character.bloodline;
    const starterBloodline = starterSavedBloodlines.find((bloodline) => bloodline.name === starterBloodlineName);
    const equippedBloodline = [...savedBloodlines, ...starterSavedBloodlines].find((bloodline) => bloodline.id === character.equippedBloodlineId);
    const active = equippedBloodline ?? starterBloodline;
    return active ? [active] : [];
}

/**
 * Does this jutsu get its element access through one of the character's
 * equipped bloodlines' special element? Used to decide whether an element
 * jutsu is usable even though the character doesn't own the element.
 */
export function isBloodlineSpecialElementJutsu(
    character: Character,
    jutsu: Jutsu,
    savedBloodlines: SavedBloodline[],
): boolean {
    return getCharacterBloodlines(character, savedBloodlines).some((bloodline) =>
        Boolean(bloodline.specialElement) &&
        bloodline.specialElement?.toLowerCase() === jutsu.element.toLowerCase() &&
        bloodline.jutsus.some((bloodlineJutsu) => bloodlineJutsu.id === jutsu.id),
    );
}

/** Is this jutsu included in any of the character's equipped bloodlines? */
export function isBloodlineJutsu(
    character: Character,
    jutsu: Jutsu,
    savedBloodlines: SavedBloodline[],
): boolean {
    return getCharacterBloodlines(character, savedBloodlines).some((bloodline) =>
        bloodline.jutsus.some((bloodlineJutsu) => bloodlineJutsu.id === jutsu.id),
    );
}

/** A stored or built-in bloodline technique outside the character's carried kits. */
export function isUncarriedBloodlineJutsu(
    character: Pick<Character, "bloodline" | "equippedBloodlineId">,
    jutsu: Pick<Jutsu, "id">,
    savedBloodlines: SavedBloodline[],
): boolean {
    const active = getCharacterBloodlines(character, savedBloodlines)[0];
    const jutsuId = String(jutsu.id ?? "").trim().toLowerCase();
    const builtinOwner = starterSavedBloodlines.find((bloodline) =>
        bloodline.jutsus.some((entry) => String(entry.id ?? "").trim().toLowerCase() === jutsuId));
    if (builtinOwner) return active?.id !== builtinOwner.id;
    const owner = savedBloodlines
        .some((bloodline) => bloodline.jutsus.some((entry) => String(entry.id ?? "").trim().toLowerCase() === jutsuId));
    return owner && !active?.jutsus.some((entry) => String(entry.id ?? "").trim().toLowerCase() === jutsuId);
}

/**
 * Full access check: can this character equip this jutsu? Universal
 * (no element) always passes; bloodline jutsu always pass; otherwise
 * the character must own the element or have it via a bloodline's
 * special element.
 */
export function canEquipElementJutsu(
    character: Character,
    jutsu: Jutsu,
    savedBloodlines: SavedBloodline[],
): boolean {
    if (isUncarriedBloodlineJutsu(character, jutsu, savedBloodlines)) return false;
    // No element (or explicit "None") — universal jutsu, always accessible.
    if (!jutsu.element || jutsu.element === "None") return true;
    // Bloodline jutsu — accessible regardless of owned elements since the bloodline itself grants access.
    if (isBloodlineJutsu(character, jutsu, savedBloodlines)) return true;
    // Elemental jutsu — character must own the element (or have it via bloodline special element).
    return hasCharacterElement(character, jutsu.element) || isBloodlineSpecialElementJutsu(character, jutsu, savedBloodlines);
}
