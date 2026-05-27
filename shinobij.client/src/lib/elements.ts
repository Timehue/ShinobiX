/*
 * Element / awakening helpers.
 *
 * Pure utility functions for working with a character's owned elements
 * (Fire / Water / Wind / Earth / Lightning) and the awakening roll system
 * that grants new ones at level 2 and level 20.
 *
 * Zero closures, zero React. Each function takes its inputs as args.
 * Extracted from App.tsx.
 */

import type { Character } from "../types/character";
import { AWAKENING_ELEMENTS } from "../constants/game";

// ── Display helpers ──────────────────────────────────────────────────────

export function elementIcon(element?: string): string {
    if (element === "Water") return "🌊";
    if (element === "Wind") return "🌀";
    if (element === "Earth") return "⛰";
    if (element === "Lightning") return "⚡";
    if (element === "Fire") return "🔥";
    return "✦";
}

// Strip null/undefined/empty entries and de-duplicate (case-insensitive)
// while preserving first-occurrence order.
export function uniqueElements(elements: (string | undefined | null)[]): string[] {
    const seen = new Set<string>();
    return elements
        .map((element) => element?.trim())
        .filter((element): element is string => Boolean(element))
        .filter((element) => {
            const key = element.toLowerCase();
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
}

// ── Character-level lookups ──────────────────────────────────────────────

export function getCharacterElements(
    character: Pick<Character, "element" | "elements">,
): string[] {
    return uniqueElements([...(character.elements ?? []), character.element]);
}

export function hasCharacterElement(
    character: Pick<Character, "element" | "elements">,
    element?: string,
): boolean {
    if (!element) return true;
    const ownedElements = getCharacterElements(character).map((owned) => owned.toLowerCase());
    return ownedElements.includes(element.toLowerCase());
}

// ── Awakening rolls ──────────────────────────────────────────────────────

// Random element from the full awakening pool (Water / Wind / Earth /
// Lightning / Fire). Used as the fallback when the player already owns
// every element.
export function rollAwakeningElement(): string {
    return AWAKENING_ELEMENTS[Math.floor(Math.random() * AWAKENING_ELEMENTS.length)];
}

// Roll a NEW element the character doesn't yet own. Falls back to a random
// element from the full pool if every element is already owned.
export function rollNewAwakeningElement(currentElements: string[]): string {
    const current = new Set(currentElements.map((element) => element.toLowerCase()));
    const available = AWAKENING_ELEMENTS.filter((element) => !current.has(element.toLowerCase()));
    return available.length
        ? available[Math.floor(Math.random() * available.length)]
        : rollAwakeningElement();
}

// Roll N new awakening elements in sequence, each unique against the prior
// rolls in this batch. Used by admin tools and the multi-roll fate spinner.
export function rollAwakeningElements(count: number): string[] {
    return Array.from({ length: Math.min(count, AWAKENING_ELEMENTS.length) }).reduce<string[]>(
        (elements) => [...elements, rollNewAwakeningElement(elements)],
        [],
    );
}
