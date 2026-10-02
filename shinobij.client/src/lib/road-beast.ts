/*
 * Road beast identity on the World Map. The rule itself is shared with the
 * server (shared/wanderer-beast.ts): a natural beast wanderer locks onto one of
 * the player's ready carried pets and is a wild pet of that pet's rarity. This
 * module feeds it the client's view of "ready carried pets", which mirrors the
 * server's road-duel filter (activeCarriedPets + showdownBusyIssue in
 * api/pet/_wanderer-showdown.ts), and dresses the wanderer in the result so the
 * billboard, the dialog and the fight all name and show the same creature.
 */
import { rawPetPool } from "../data/pet-pool";
import { activeCarriedPets } from "./entitlements";
import { isPetAvailableForColosseum } from "./pet";
import { petPortraitImage } from "./pet-battle-anim";
import { activeClientBreedingParentIds } from "./pet-breeding";
import { serverNow } from "./server-clock";
import type { Wanderer } from "./wanderers";
import type { Character } from "../types/character";
import type { Pet } from "../types/pet";
import { wandererBeastName, wandererBeastRival, wandererBeastSpecies } from "../../../shared/wanderer-beast";

export interface RoadBeastIdentity {
    /** The player's pet the beast challenges. It leads the player's side. */
    rival: Pet;
    /** The catalog template the beast fields in its own slot 0. */
    species: Pet;
    /** "Stray Desert Lizard". */
    name: string;
}

/** The pets the server may send against a road beast, in the same terms. */
export function roadBeastReadyPets(character: Character, now = serverNow()): Pet[] {
    const breeding = activeClientBreedingParentIds(character, now);
    return activeCarriedPets(character).filter((pet) => isPetAvailableForColosseum(pet, breeding, now));
}

/** Who this beast is for this player, or null when it is not a beast or the
 *  player has no ready pet for it to challenge. */
export function roadBeastIdentity(wanderer: Wanderer, readyPets: readonly Pet[]): RoadBeastIdentity | null {
    if (wanderer.verb !== "petDuel") return null;
    const rival = wandererBeastRival(wanderer.id, readyPets);
    const species = rival ? wandererBeastSpecies(wanderer.id, rival.rarity, rawPetPool) : null;
    if (!rival || !species) return null;
    return { rival, species, name: wandererBeastName(wanderer.name, species.name) };
}

/** The wanderer as this player meets it: the species' name, portrait and
 *  level (the server levels the beast's lead to its rival), and a greeting
 *  that says which pet it has picked out. Anything that is not a beast with a
 *  rival passes through unchanged (the neutral "Stray Beast"). */
export function withRoadBeastIdentity(
    wanderer: Wanderer,
    readyPets: readonly Pet[],
    sharedImages: Record<string, string> = {},
): Wanderer {
    const identity = roadBeastIdentity(wanderer, readyPets);
    if (!identity) return wanderer;
    const portrait = petPortraitImage({ ...identity.species, templateId: identity.species.id }, sharedImages);
    return {
        ...wanderer,
        name: identity.name,
        level: Math.max(1, Math.min(100, Math.round(Number(identity.rival.level) || 1))),
        greeting: `${wanderer.greeting} It has singled out ${identity.rival.name}.`,
        ...(portrait ? { avatarImage: portrait } : {}),
    };
}
