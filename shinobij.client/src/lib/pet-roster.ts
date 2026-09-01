/**
 * The built-in pet roster — drained verbatim out of App.tsx.
 *
 * `petPool` is the balanced built-in template list; `normalizePet` binds it as
 * the baseline fallback for lib/pet-balance's normalizePetTemplate, and
 * `mergeMissingBuiltInPets` back-fills a save that predates a new built-in.
 *
 * These lived in App only because they close over the petPool array. Moving them
 * here is what lets normalizeCharacter (./normalize-character) leave App at all:
 * it calls normalizePet, and a lib module cannot reach back into App without
 * dragging App's component/CSS imports into every test that loads it.
 *
 * Behaviour is unchanged. The ONLY edit to the moved statements is the `export`
 * keyword on the three declarations, which App now imports back.
 */
import type { Pet } from "../types/pet";
import { rawPetPool } from "../data/pet-pool";
import { STARTER_PETS } from "../data/starter-pets";
import { STARTER_EVOLUTIONS } from "../data/pet-evolutions";
import { balanceBuiltInPetTemplate, normalizePetTemplate } from "./pet-balance";

// Raw pet templates (./data/pet-pool) are scaled by the balancer; the 5 starter
// companions AND their 10 evolved templates (data/starter-pets, pet-evolutions)
// are appended UNBALANCED (hand-authored stats/kits). Both are surfaced in the
// admin Pet Editor for imaging and seeded into editablePets, but excluded from
// wild encounters by isWildSpawnable — a starter or evolution never shows up as
// a random wild beast.
export const petPool: Pet[] = [
    ...rawPetPool.map(balanceBuiltInPetTemplate),
    ...STARTER_PETS.map((option) => option.pet),
    ...STARTER_EVOLUTIONS,
];

export function mergeMissingBuiltInPets(currentPets: Pet[]): Pet[] {
    const currentIds = new Set(currentPets.map((pet) => pet.id));
    const missingBuiltInPets = petPool.filter((pet) => !currentIds.has(pet.id));

    return [...currentPets, ...missingBuiltInPets];
}

// normalizePet's logic lives in ./lib/pet-balance (normalizePetTemplate); here we
// only bind the App-local petPool (balanced rawPetPool + starters/evolutions) as
// its baseline fallback. cloneEncounterPet + the published-template registry also
// live in ./lib/pet-balance.
export function normalizePet(pet: Pet): Pet {
    return normalizePetTemplate(pet, petPool);
}
