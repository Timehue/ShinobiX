import { rawPetPool } from "../data/pet-pool";
import { balanceBuiltInPetTemplate } from "./pet-balance";
import type { Character } from "../types/character";
import type { Pet } from "../types/pet";
import { BRED_APEX_TRAIT_CHANCE_PERCENT } from "../../../shared/shrines";

// Mirror the authoritative server breeding pool exactly. Breeding-only species
// deliberately set wildSpawnable:false, so encounter eligibility must not hide
// them from the Barn's same-element/same-rarity odds preview.
const BREEDING_CATALOG = rawPetPool.map(balanceBuiltInPetTemplate).filter((pet) => pet.breedable !== false);

export const PET_BREEDING_MIN_LEVEL = 50;
export { BRED_APEX_TRAIT_CHANCE_PERCENT };

export type PetBreedingOdds = {
    parent1: number;
    parent2: number;
    alternate: number;
    randomNonStandard: number;
    chromatic: number;
    apexTrait: number;
};

export function activeClientBreedingParentIds(character: Character, now = Date.now()): Set<string> {
    const session = character.petBreeding;
    return session?.state === "breeding" && now < session.readyAt ? new Set(session.parentIds) : new Set();
}

export function clientPetBreedingBlocker(character: Character, pet: Pet, now = Date.now()): string | null {
    if (pet.breedable === false) return "Protected companion";
    if (!pet.element || pet.element === "None") return "No elemental affinity";
    if (Number(pet.level ?? 0) < PET_BREEDING_MIN_LEVEL) return `Requires level ${PET_BREEDING_MIN_LEVEL}`;
    if (Number(pet.breedingUsesRemaining ?? 0) <= 0) return "No breeding uses";
    if (activeClientBreedingParentIds(character, now).has(pet.id)) return "Already in the barn";
    if (pet.training) return "Training in progress";
    if (pet.expedition) return "Expedition in progress";
    if (character.activePetId === pet.id) return "Active PvE pet";
    if (character.activePetId2v2 === pet.id) return "Active 2v2 reserve";
    return null;
}

function alternatePool(parent1: Pet, parent2: Pet, rarity: string): Pet[] {
    const excluded = new Set([parent1.templateId, parent2.templateId].filter(Boolean));
    return BREEDING_CATALOG.filter((pet) => pet.element === parent1.element && pet.rarity === rarity && !excluded.has(pet.id));
}

export function breedingOddsForPets(parent1: Pet, parent2: Pet): PetBreedingOdds {
    const rarities = parent1.rarity === parent2.rarity ? [parent1.rarity] : [parent1.rarity, parent2.rarity];
    const availableAnchors = rarities.filter((rarity) => alternatePool(parent1, parent2, rarity).length > 0).length;
    const alternate = rarities.length === 1 ? (availableAnchors ? 9 : 0) : availableAnchors * 4.5;
    const fallback = 9 - alternate;
    return {
        parent1: 45 + fallback / 2,
        parent2: 45 + fallback / 2,
        alternate,
        randomNonStandard: 1,
        chromatic: 0.05,
        apexTrait: BRED_APEX_TRAIT_CHANCE_PERCENT,
    };
}

export function compatibleBreedingPets(character: Character, first: Pet | null, now = Date.now()): Pet[] {
    return character.pets.filter((pet) => !clientPetBreedingBlocker(character, pet, now) && (!first || pet.id === first.id || pet.element === first.element));
}

export function formatBreedingDuration(milliseconds: number): string {
    const safe = Math.max(0, Math.floor(milliseconds / 1000));
    const hours = Math.floor(safe / 3600);
    const minutes = Math.floor((safe % 3600) / 60);
    const seconds = safe % 60;
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}
