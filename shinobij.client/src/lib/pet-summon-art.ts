import { petVisualId } from "../data/pet-evolutions";
import { PET_SUMMON_KINDS } from "./pet-summon-index";
import type { Pet } from "../types/pet";
import { petBattlefieldArt } from "./pet-battle-anim";

/** The combat snapshot keeps the form that answered the summon, even for another player's pet. */
export function petSummonBattleArt(pet: Pet | undefined, instanceId: string, sealedSpecies: unknown, sharedImages?: Record<string, string>) {
    let legacyId = instanceId.split(":")[0];
    // Older clones appended hyphenated suffixes to a species or an evolved starter ID.
    while (!PET_SUMMON_KINDS.has(legacyId) && legacyId.includes("-")) {
        legacyId = legacyId.slice(0, legacyId.lastIndexOf("-"));
    }
    const owner = pet && !PET_SUMMON_KINDS.has(pet.templateId ?? "") && PET_SUMMON_KINDS.has(legacyId)
        ? { ...pet, templateId: legacyId } : pet;
    const ownedId = owner && petVisualId(owner);
    const id = [sealedSpecies, ownedId, legacyId].find((value): value is string =>
        typeof value === "string" && PET_SUMMON_KINDS.has(value));
    if (!id) return petBattlefieldArt(pet, instanceId, sharedImages);

    const fallback = petBattlefieldArt(id === ownedId ? owner : undefined, id, sharedImages);
    return { sprite: `/combat-actors/pets/${PET_SUMMON_KINDS.get(id)}/${id}-guard.webp?v=1`, fallback: fallback.sprite };
}
