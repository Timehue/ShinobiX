import type { Pet } from "../types/pet";
export type PublicPetRoster = { eligiblePets?: Pet[] };

/** Consume the server's explicit public combat projection. Never re-derive a
 * foreign player's entitlement from their redacted character DTO. */
export function publicEligiblePets(player: PublicPetRoster | null | undefined): Pet[] {
    return Array.isArray(player?.eligiblePets) ? player.eligiblePets : [];
}
