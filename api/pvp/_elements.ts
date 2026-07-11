// Shared, dependency-free element helpers for combat + item endpoints.
//
// Kept as a leaf module (no combat/storage imports) so both api/pvp/move.ts and
// the weapon-attunement endpoint can use it without pulling the whole combat
// engine in, and without an import cycle (move.ts imports session.ts).

// If the wielder owns `element` as an awakened element (character.elements[] +
// character.element), return it in its STORED casing; else null. Case-insensitive
// match, but an empty/missing element returns null. Returning the canonical stored
// form lets callers (the Elemental Core endpoint) persist the exact casing that
// PvP's case-sensitive VALID_WEAPON_ELEMENTS whitelist will honor.
export function canonicalOwnedElement(character: Record<string, unknown> | null | undefined, element: unknown): string | null {
    const want = String(element ?? '').trim().toLowerCase();
    if (!want) return null;
    if (!character || typeof character !== 'object') return null;
    const list = Array.isArray((character as { elements?: unknown }).elements)
        ? ((character as { elements?: unknown[] }).elements as unknown[])
        : [];
    for (const e of [...list, (character as { element?: unknown }).element]) {
        const s = String(e ?? '').trim();
        if (s && s.toLowerCase() === want) return s;
    }
    return null;
}

// Does the wielder own `element` as an awakened element? Mirrors the client
// hasCharacterElement (lib/elements.ts). A no-element weapon returns FALSE — it
// must NOT earn the bloodline boost. Gates the weapon → bloodline-multiplier link.
export function characterOwnsElement(character: Record<string, unknown> | null | undefined, element: unknown): boolean {
    return canonicalOwnedElement(character, element) !== null;
}
