import { PET_CATALOG } from './_catalog.js';
import { createOwnedPet, resolvePetTemplateId } from './_owned-pet.js';

const TRAITS = ['Loyal', 'Aggressive', 'Guardian', 'Swift', 'Lucky', 'Battleborn'] as const;
export type WildPetTrait = typeof TRAITS[number];
export const DAILY_WILD_ENCOUNTER_ATTEMPTS = 150;

export function rollWildPet(random: () => number, now = Date.now()): Record<string, unknown> | null {
    const roll = random();
    const rarity = roll <= 0.002 ? 'mythic' : roll <= 0.007 ? 'legendary' : roll <= 0.01 ? 'rare' : roll <= 0.05 ? 'standard' : null;
    if (!rarity) return null;
    const pool = Object.values(PET_CATALOG).filter((pet) => pet.rarity === rarity && pet.wildSpawnable !== false);
    const template = pool[Math.floor(Math.max(0, Math.min(0.999999, random())) * pool.length)];
    return template ? { ...structuredClone(template), id: `${template.id}-${now}` } : null;
}

export function grantWildPet(character: Record<string, unknown>, pet: Record<string, unknown>, random: () => number) {
    const pets = Array.isArray(character.pets) ? character.pets as Array<Record<string, unknown>> : [];
    const templateId = resolvePetTemplateId(pet);
    if (!templateId) return { ok: false as const, reason: 'invalid-pet-template' as const };
    const secureInt = (min: number, max: number) => min + Math.floor(Math.max(0, Math.min(0.999999999, random())) * (max - min));
    const granted = createOwnedPet(templateId, {
        origin: 'wild',
        instanceId: String(pet.id ?? ''),
        existingIds: pets.map((entry) => String(entry.id ?? '')),
        basePet: pet,
        secureInt,
    });
    const trait = granted.trait as WildPetTrait;
    return { ok: true as const, trait, pet: granted, character: { ...character, pets: [...pets, granted] } };
}
