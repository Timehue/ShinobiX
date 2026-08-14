import type { Pet } from '../_pet-sim/pet-types.js';

const finite = (value: unknown): number => {
    const n = Number(value);
    return Number.isFinite(n) ? Math.max(0, n) : 0;
};

/**
 * Estimate the threat represented by the combat snapshot that was actually
 * sealed for a Pet Coliseum fight. Account level is intentionally absent: pets
 * can be bred and trained far beyond (or below) their owner's level.
 */
export function sealedPetThreat(pet: Pick<Pet, 'level' | 'hp' | 'attack' | 'defense' | 'speed' | 'jutsus'>): number {
    const strongestJutsu = Array.isArray(pet.jutsus)
        ? pet.jutsus.reduce((best, jutsu) => Math.max(best, finite(jutsu?.power)), 0)
        : 0;
    return finite(pet.level) * 1.2
        + finite(pet.hp) / 30
        + finite(pet.attack) / 4
        + finite(pet.defense) / 5
        + finite(pet.speed) / 8
        + strongestJutsu / 10;
}

/**
 * Ryo paid for beating this exact sealed team. The strongest pet determines
 * most of the purse; a reserve adds 60% of its threat so 2v2 cannot double the
 * faucet. Bounds preserve the old low-level floor and cap pathological/admin
 * pets without consulting the owner's account level.
 */
export function petArenaRyoRewardForTeam(pets: readonly Pet[]): number {
    const threats = pets.map(sealedPetThreat).filter(Number.isFinite).sort((a, b) => b - a);
    if (threats.length === 0) return 20;
    const weighted = threats[0] + (threats[1] ?? 0) * 0.6;
    return Math.max(20, Math.min(250, Math.round(weighted * 0.75)));
}
