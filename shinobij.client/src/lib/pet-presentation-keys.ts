/** Pure keys shared by gameplay logic and pet presentation.
 * Keep this module free of the portrait, evolution and pose catalogs. */
import type { JutsuElement } from '../types/core';
import type { PetVfxKey } from '../types/pet-battle';

/** Strip the per-encounter `-<timestamp>` suffix to recover the template id. */
export function petStripVariant(id: string): string {
    return id.replace(/-\d{10,}$/, "");
}

/** Map a pet's chakra element to its VFX tint. */
export function elementVfxKey(element?: JutsuElement | string | null): PetVfxKey {
    switch (String(element ?? "").toLowerCase()) {
        case "fire": return "fire";
        case "water": return "water";
        case "wind": return "wind";
        case "lightning": return "lightning";
        case "earth": return "earth";
        default: return "none";
    }
}
