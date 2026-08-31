import type { Screen } from "../types/core";

const PET_EXPEDITION_PET_HINT = "shinobix:pet-expedition-pet:v1";
export const PET_EXPEDITION_OPEN_EVENT = "shinobix:open-pet-expedition";

export function readPetExpeditionPetHint(): string | null {
    if (typeof window === "undefined") return null;
    try {
        const value = window.sessionStorage.getItem(PET_EXPEDITION_PET_HINT)?.trim();
        return value && value.length <= 200 ? value : null;
    } catch {
        return null;
    }
}

export function clearPetExpeditionPetHint(): void {
    if (typeof window === "undefined") return;
    try { window.sessionStorage.removeItem(PET_EXPEDITION_PET_HINT); } catch { /* navigation still works */ }
}

export function openPetExpedition(petId: string, setScreen: (screen: Screen) => void): void {
    try { window.sessionStorage.setItem(PET_EXPEDITION_PET_HINT, petId); } catch { /* navigation still works */ }
    setScreen("pets");
    try { window.dispatchEvent(new CustomEvent(PET_EXPEDITION_OPEN_EVENT, { detail: { petId } })); } catch { /* destination reads storage on mount */ }
}
