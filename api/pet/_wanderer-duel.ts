/* Server-owned opponent construction for a natural sector pet wanderer. */

import { SERVER_ARENA_PETS } from './_arena-ai.js';
import { petJutsuPowerCeil } from '../_pet-stat-ceil.js';
import type { Pet, PetJutsu } from '../_pet-sim/pet-types.js';

export const WANDERER_TIERS: readonly { readonly minLevel: number; readonly petId: string }[] = [
    { minLevel: 45, petId: 'generic-ai-pet-emberlynx' },
    { minLevel: 20, petId: 'generic-ai-pet-guardhound' },
    { minLevel: 1, petId: 'generic-ai-pet-sparrow' },
];

const clampLevel = (value: unknown): number => Math.max(1, Math.min(100, Math.round(Number(value) || 1)));

function scaleJutsus(jutsus: readonly PetJutsu[], rarity: unknown, multiplier: number): PetJutsu[] {
    const ceiling = petJutsuPowerCeil(rarity);
    return jutsus.map((jutsu) => ({
        ...jutsu,
        power: Number(jutsu.power) > 0
            ? Math.min(ceiling, Math.max(1, Math.round(Number(jutsu.power) * multiplier)))
            : 0,
        currentCooldown: 0,
    }));
}

export function wandererTierFor(playerLevel: number): string {
    const level = clampLevel(playerLevel);
    return (WANDERER_TIERS.find((tier) => level >= tier.minLevel) ?? WANDERER_TIERS[WANDERER_TIERS.length - 1]).petId;
}

/** Port of WorldMap's former preview scaling, now derived only from the saved
 * character level and the server roster. */
export function buildWandererBeast(playerLevel: number): Pet | null {
    const target = clampLevel(playerLevel);
    const base = SERVER_ARENA_PETS[wandererTierFor(target)];
    if (!base) return null;
    const multiplier = Math.max(0.7, Math.min(4, target / Math.max(1, Number(base.level) || 1)));
    const positive = (value: number): number => Math.max(1, Math.round(value));
    return {
        ...base,
        level: target,
        hp: positive(Number(base.hp) * multiplier),
        attack: positive(Number(base.attack) * multiplier),
        defense: positive(Number(base.defense) * multiplier),
        speed: positive(Number(base.speed) * Math.min(1.5, multiplier)),
        jutsus: scaleJutsus(base.jutsus ?? [], base.rarity, multiplier),
        moveRange: Math.max(2, Math.min(5, Math.round(Number(base.moveRange) || 3))),
    } as Pet;
}
