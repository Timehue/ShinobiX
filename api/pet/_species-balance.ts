import { petJutsuPowerCeil } from '../_pet-stat-ceil.js';
import { PET_CATALOG } from './_catalog.js';
import { normalizePetGrowth, petGrowthBaseStats } from './_growth.js';
import { PREVIOUS_PET_SPECIES_BASES } from './_species-balance-v1.js';

/** Apply species tuning once, independently of level/point migration. Sealed
 * battles retain their snapshots; owned roster reads/mutations persist this
 * through the existing versioned save boundary. */
export function rebalanceOwnedPetSpecies(
    pet: Record<string, unknown>,
    templateId: string,
): { pet: Record<string, unknown>; changed: boolean } {
    const template = PET_CATALOG[templateId];
    const previous = PREVIOUS_PET_SPECIES_BASES[templateId];
    const version = Number(template?.speciesBalanceVersion) || 0;
    if (!previous || !version || Number(pet.speciesBalanceVersion) >= version
        || pet.rarity !== template.rarity || pet.origin === 'admin') return { pet, changed: false };

    const base = petGrowthBaseStats(pet);
    const stats = ['hp', 'attack', 'defense', 'speed'] as const;
    // Preserve any authored base adjustment proportionally. Earned levels and
    // allocations remain separate, so neither can be erased or applied twice.
    const growthBaseStats = Object.fromEntries(stats.map((stat, index) => [
        stat, Math.max(1, Math.round(base[stat] * Number(template[stat]) / previous[index])),
    ]));
    const canonical = template.jutsus as Array<Record<string, unknown>>;
    const byName = new Map(canonical.map((move, index) => [String(move.name), { move, oldPower: previous[index + 4] }]));
    const jutsus = Array.isArray(pet.jutsus) ? pet.jutsus.map((raw: Record<string, unknown>) => {
        const entry = byName.get(String(raw.name));
        if (!entry || entry.oldPower === undefined || Number(entry.move.power) <= 0) return raw;
        const earned = Math.max(0, Number(raw.power) - entry.oldPower);
        if (!Number.isFinite(earned)) return raw;
        return { ...raw, power: Math.min(petJutsuPowerCeil(pet.rarity), Number(entry.move.power) + earned) };
    }) : pet.jutsus;
    return {
        pet: normalizePetGrowth({ ...pet, growthBaseStats, jutsus, speciesBalanceVersion: version }),
        changed: true,
    };
}
