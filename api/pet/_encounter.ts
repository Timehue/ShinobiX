import { PET_CATALOG } from './_catalog.js';
import { createOwnedPet, resolvePetTemplateId, rollOwnedPetTrait } from './_owned-pet.js';
import { sectorWeatherElements, type SectorWeather } from '../../shared/sector-weather.js';
import { isWorldNight } from '../../shared/world-phase.js';
import { isNightOnlyWildPet, NIGHT_PET_NIGHT_WEIGHT } from '../../shared/night-pets.js';
import { PET_MAX_LEVEL } from './_growth.js';

const TRAITS = ['Loyal', 'Aggressive', 'Guardian', 'Swift', 'Lucky', 'Battleborn'] as const;
export type WildPetTrait = typeof TRAITS[number];
export const DAILY_WILD_ENCOUNTER_ATTEMPTS = 150;

/** The Explore hit ceiling: a roll above this is a miss. */
const WILD_HIT_CEILING = 0.05;

function petLevel(value: unknown): number {
    const level = Number(value);
    return Number.isFinite(level) ? Math.max(1, Math.min(PET_MAX_LEVEL, Math.floor(level))) : 1;
}

/** Roll once when the chosen companion enters battle; both endpoints are inclusive. */
export function rollWildPetLevel(companionLevel: unknown, random: () => number): number {
    const max = petLevel(companionLevel);
    const min = Math.max(1, max - 20);
    return min + Math.floor(Math.max(0, Math.min(0.999999999, random())) * (max - min + 1));
}

/**
 * `guaranteed` (a Tracker trail's final sector) always yields a pet: the first
 * roll is scaled into the hit band, so the rarity mix is exactly an Explore
 * HIT's (80% standard, 6% rare, 10% legendary, 4% mythic).
 */
export function rollWildPet(random: () => number, now = Date.now(), condition?: { weather: SectorWeather }, options?: { guaranteed?: boolean }): Record<string, unknown> | null {
    const roll = options?.guaranteed ? random() * WILD_HIT_CEILING : random();
    const rarity = roll <= 0.002 ? 'mythic' : roll <= 0.007 ? 'legendary' : roll <= 0.01 ? 'rare' : roll <= WILD_HIT_CEILING ? 'standard' : null;
    if (!rarity) return null;
    // Night-only pets (shared/night-pets.ts) are in the pool only after dark,
    // judged by the same world clock as the sky. Like weather, this changes
    // WHICH pet of the sealed rarity appears, never the hit or rarity roll.
    const night = isWorldNight(now);
    const pool = Object.values(PET_CATALOG).filter((pet) => pet.rarity === rarity && pet.wildSpawnable !== false
        && (night || !isNightOnlyWildPet(String(pet.id))));
    const unit = Math.max(0, Math.min(0.999999, random()));
    let template: typeof pool[number] | undefined = pool[Math.floor(unit * pool.length)];
    // World weather changes WHICH pet of the sealed rarity appears, never the
    // original hit/miss or rarity roll above. Clan-stamped skies are resolved by
    // encounter-start before this function receives the condition.
    const nightWeight = (id: string) => (night && isNightOnlyWildPet(id) ? NIGHT_PET_NIGHT_WEIGHT : 1);
    if ((condition || night) && pool.length > 0) {
        const elements = condition ? sectorWeatherElements(condition.weather) : null;
        const weights = pool.map((pet) => (!elements ? 1
            : pet.element === elements.positiveElement ? 2.5
            : pet.element === elements.negativeElement ? 0.75 : 1) * nightWeight(String(pet.id)));
        const target = unit * weights.reduce((sum, weight) => sum + weight, 0);
        let cumulative = 0;
        template = pool.find((_, index) => (cumulative += weights[index]) > target) ?? pool.at(-1);
    }
    if (!template) return null;
    const secureInt = (min: number, max: number) => min + Math.floor(Math.max(0, Math.min(0.999999999, random())) * (max - min));
    const trait = rollOwnedPetTrait(template.rarity, secureInt) as WildPetTrait;
    return { ...structuredClone(template), id: `${template.id}-${now}`, trait };
}

export function grantWildPet(character: Record<string, unknown>, pet: Record<string, unknown>, random: () => number) {
    const pets = Array.isArray(character.pets) ? character.pets as Array<Record<string, unknown>> : [];
    const templateId = resolvePetTemplateId(pet);
    if (!templateId) return { ok: false as const, reason: 'invalid-pet-template' as const };
    const secureInt = (min: number, max: number) => min + Math.floor(Math.max(0, Math.min(0.999999999, random())) * (max - min));
    // The rolled level only affects the wild battle; capture starts fresh at level 1.
    const granted = createOwnedPet(templateId, {
        origin: 'wild',
        instanceId: String(pet.id ?? ''),
        existingIds: pets.map((entry) => String(entry.id ?? '')),
        basePet: pet,
        ...(TRAITS.includes(pet.trait as WildPetTrait) ? { trait: pet.trait as WildPetTrait } : {}),
        secureInt,
    });
    const trait = granted.trait as WildPetTrait;
    return { ok: true as const, trait, pet: granted, character: { ...character, pets: [...pets, granted] } };
}
