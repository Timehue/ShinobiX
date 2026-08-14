import type { PlayerRecord, ServerPlayerSummary } from "../types/character";
import type { Pet } from "../types/pet";

/**
 * Foreign Patreon state is intentionally private, so clients must not derive
 * another player's carried cap from character.pets. Only the server projection
 * is combat-authoritative; missing data fails closed.
 */
export function publicEligiblePets(
    player: Pick<PlayerRecord, "eligiblePets"> | Pick<ServerPlayerSummary, "eligiblePets"> | null | undefined,
): Pet[] {
    return Array.isArray(player?.eligiblePets) ? player.eligiblePets : [];
}
