import type { Pet, PetBreedingSession } from "../types/pet";
import { serverNow } from "./server-clock";

export type ClientPetCombatBusyCode =
    | "pet-is-breeding"
    | "pet-is-training"
    | "pet-is-on-expedition";

type ClientPetCombatBusyCharacter = {
    petBreeding?: Pick<PetBreedingSession, "state" | "parentIds" | "readyAt"> | null;
};

type ClientPetCombatBusyPet = Pick<Pet, "id" | "training" | "expedition">;

export function activeClientBreedingParentIds(
    character: ClientPetCombatBusyCharacter,
    now = serverNow(),
): Set<string> {
    const session = character.petBreeding;
    return session?.state === "breeding" && now < session.readyAt
        ? new Set(session.parentIds)
        : new Set();
}

/**
 * Client mirror of api/pet/_pet-busy.ts::petCombatBusyReason.
 *
 * Training and expedition records remain busy until their collect flows clear
 * them, even after their timers finish. Breeding parents unlock at readyAt.
 */
export function clientPetCombatBusyReason(
    character: ClientPetCombatBusyCharacter,
    pet: ClientPetCombatBusyPet,
    now = serverNow(),
): ClientPetCombatBusyCode | null {
    if (activeClientBreedingParentIds(character, now).has(pet.id)) return "pet-is-breeding";
    if (pet.training) return "pet-is-training";
    if (pet.expedition) return "pet-is-on-expedition";
    return null;
}

export function clientPetCombatBusyMessage(code: ClientPetCombatBusyCode, petName = "This pet"): string {
    switch (code) {
        case "pet-is-breeding": return `${petName} is in the breeding barn and cannot join PvE battles.`;
        case "pet-is-training": return `${petName} has training in progress or waiting to be collected and cannot join PvE battles.`;
        case "pet-is-on-expedition": return `${petName} is on an expedition or has an unclaimed expedition and cannot join PvE battles.`;
    }
}
