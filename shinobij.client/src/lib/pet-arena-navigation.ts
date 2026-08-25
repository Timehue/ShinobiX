import type { Screen } from "../types/core";

export type PetArenaView = "battle" | "tactical" | "gauntlet";

const PET_ARENA_VIEW_HINT = "shinobix:pet-arena-view:v1";
const PET_ARENA_PET_HINT = "shinobix:pet-arena-pet:v1";
const PET_COLOSSEUM_PET_HINT = "shinobix:pet-colosseum-pet:v1";

function isPetArenaView(value: string | null): value is PetArenaView {
    return value === "battle" || value === "tactical" || value === "gauntlet";
}

function readPetId(key: string): string | null {
    if (typeof window === "undefined") return null;
    try {
        const value = window.sessionStorage.getItem(key)?.trim();
        return value && value.length <= 200 ? value : null;
    } catch {
        return null;
    }
}

/** Read the destination selected by another companion screen.
 *
 * Reading is deliberately pure: React Strict Mode may call a state initializer
 * twice, so consuming storage here would make the second call fall back to the
 * default view. PetArena clears the hint after its first committed mount. */
export function readPetArenaViewHint(): PetArenaView {
    if (typeof window === "undefined") return "battle";
    try {
        const value = window.sessionStorage.getItem(PET_ARENA_VIEW_HINT);
        return isPetArenaView(value) ? value : "battle";
    } catch {
        return "battle";
    }
}

export function readPetArenaPetHint(): string | null {
    return readPetId(PET_ARENA_PET_HINT);
}

export function readPetColosseumPetHint(): string | null {
    return readPetId(PET_COLOSSEUM_PET_HINT);
}

export function clearPetArenaNavigationHint(): void {
    if (typeof window === "undefined") return;
    try {
        window.sessionStorage.removeItem(PET_ARENA_VIEW_HINT);
        window.sessionStorage.removeItem(PET_ARENA_PET_HINT);
    } catch { /* storage unavailable */ }
}

export function clearPetColosseumPetHint(): void {
    if (typeof window === "undefined") return;
    try { window.sessionStorage.removeItem(PET_COLOSSEUM_PET_HINT); } catch { /* storage unavailable */ }
}

/** Open Pet Arena on a specific activity instead of making the player re-route there. */
export function openPetArenaView(view: PetArenaView, setScreen: (screen: Screen) => void, petId?: string): void {
    try {
        window.sessionStorage.setItem(PET_ARENA_VIEW_HINT, view);
        if (petId) window.sessionStorage.setItem(PET_ARENA_PET_HINT, petId);
        else window.sessionStorage.removeItem(PET_ARENA_PET_HINT);
    } catch { /* navigation still works when storage is unavailable */ }
    setScreen("petArena");
}

/** Open the paid Colosseum lobby with the Yard's contender already selected. */
export function openPetColosseum(petId: string, setScreen: (screen: Screen) => void): void {
    try { window.sessionStorage.setItem(PET_COLOSSEUM_PET_HINT, petId); } catch { /* navigation still works */ }
    setScreen("petColiseum");
}
