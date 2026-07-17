import { PET_CATALOG } from './_catalog.js';
import { maxPets } from '../_entitlements.js';

const TRAITS = ['Loyal', 'Aggressive', 'Guardian', 'Swift', 'Lucky', 'Battleborn'] as const;
export type WildPetTrait = typeof TRAITS[number];
export const DAILY_WILD_ENCOUNTER_ATTEMPTS = 150;

export function rollWildPet(random: () => number, now = Date.now()): Record<string, unknown> | null {
    const roll = random();
    const rarity = roll <= 0.002 ? 'mythic' : roll <= 0.007 ? 'legendary' : roll <= 0.01 ? 'rare' : roll <= 0.05 ? 'standard' : null;
    if (!rarity) return null;
    const pool = Object.values(PET_CATALOG).filter((pet) => pet.rarity === rarity);
    const template = pool[Math.floor(Math.max(0, Math.min(0.999999, random())) * pool.length)];
    return template ? { ...structuredClone(template), id: `${template.id}-${now}` } : null;
}

export function grantWildPet(character: Record<string, unknown>, pet: Record<string, unknown>, random: () => number) {
    const pets = Array.isArray(character.pets) ? character.pets as Array<Record<string, unknown>> : [];
    // Subscriber-aware roster cap (Patreon perk): 3 base / 5 subscriber. This is
    // the authoritative befriend gate (the save handler only backstops it).
    if (pets.length >= maxPets(character)) return { ok: false as const, reason: 'pet-yard-full' as const };
    const pool = pet.rarity === 'mythic' ? TRAITS : TRAITS.filter((trait) => trait !== 'Guardian');
    const trait = pool[Math.floor(Math.max(0, Math.min(0.999999, random())) * pool.length)];
    const n = (key: string) => Number(pet[key]) || 0;
    let granted: Record<string, unknown> = { ...structuredClone(pet), trait };
    if (trait === 'Aggressive') granted = { ...granted, attack: Math.round(n('attack') * 1.15) };
    else if (trait === 'Battleborn') granted = { ...granted, attack: Math.round(n('attack') * 1.1), hp: Math.round(n('hp') * 1.1), defense: Math.round(n('defense') * 1.1), speed: Math.round(n('speed') * 1.1) };
    else if (trait === 'Guardian') granted = { ...granted, hp: Math.round(n('hp') * 1.2), defense: Math.round(n('defense') * 1.2) };
    else if (trait === 'Swift') granted = { ...granted, speed: Math.round(n('speed') * 1.2) };
    return { ok: true as const, trait, character: { ...character, pets: [...pets, granted] } };
}
