import type { Character } from "../types/character";
import { normalizeCharacter as normalizeBaseCharacter } from "./normalize-character";
import { normalizeNarrativeFields } from "./story-history";

/** Normalize the general save shape, then repair its bounded narrative receipts. */
export function normalizeNarrativeCharacter(parsed: Character): Character {
    const normalized = normalizeBaseCharacter(parsed);
    return { ...normalized, ...normalizeNarrativeFields(normalized) };
}
