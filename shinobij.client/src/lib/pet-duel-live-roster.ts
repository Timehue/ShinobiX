import type { Pet, PetBreedingSession } from "../types/pet";
import { serverNow } from "./server-clock";

export type LivePetDuelMode = "1v1" | "2v2";

export function requiredLivePetCount(mode: LivePetDuelMode): 1 | 2 {
    return mode === "2v2" ? 2 : 1;
}

/** Select the exact payload for a live-duel mode from an ordered candidate pool. */
export function selectLiveDuelRoster(pets: readonly Pet[], mode: LivePetDuelMode): Pet[] | null {
    const required = requiredLivePetCount(mode);
    if (pets.length < required) return null;
    const selected = pets.slice(0, required);
    const ids = selected.map((pet) => String(pet?.id ?? "").trim());
    if (ids.some((id) => !id) || new Set(ids).size !== required) return null;
    return selected;
}

export function liveDuelRosterIssue(pets: readonly Pet[], mode: LivePetDuelMode): string | null {
    if (selectLiveDuelRoster(pets, mode)) return null;
    return mode === "2v2"
        ? "A live 2v2 duel needs two distinct eligible pets."
        : "A live 1v1 duel needs one eligible pet.";
}

/** Mirror the server's petCombatBusyReason contract for live-duel admission. */
export function isLivePetDuelAvailable(
    pet: Pet,
    breedingSession: PetBreedingSession | null | undefined = null,
    now = serverNow(),
): boolean {
    if (pet.training || pet.expedition) return false;
    const isBreedingParent = breedingSession?.state === "breeding"
        && now < Number(breedingSession.readyAt)
        && breedingSession.parentIds.includes(pet.id);
    return !isBreedingParent;
}

/**
 * Build Pet Arena's ordered candidate pool. The reserve is always supplied to
 * the live host when available, even while the local 2v2 toggle is off: an
 * incoming 2v2 invite still needs a responder roster. An empty reserve choice
 * means Auto-pick, so choose the first other eligible carried pet.
 */
export function buildPetArenaLiveRoster(
    eligibleCarriedPets: readonly Pet[],
    selectedPet: Pet | undefined,
    reservePetId: string,
    breedingSession: PetBreedingSession | null | undefined = null,
    now = serverNow(),
): Pet[] {
    if (!selectedPet || !isLivePetDuelAvailable(selectedPet, breedingSession, now)) return [];
    const authoritativeLead = eligibleCarriedPets.find((pet) => pet.id === selectedPet.id);
    if (!authoritativeLead || !isLivePetDuelAvailable(authoritativeLead, breedingSession, now)) return [];
    const reserve = eligibleCarriedPets.find((pet) => (
        pet.id === reservePetId
        && pet.id !== authoritativeLead.id
        && isLivePetDuelAvailable(pet, breedingSession, now)
    )) ?? eligibleCarriedPets.find((pet) => (
        pet.id !== authoritativeLead.id
        && isLivePetDuelAvailable(pet, breedingSession, now)
    ));
    return reserve ? [authoritativeLead, reserve] : [authoritativeLead];
}
