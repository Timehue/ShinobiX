import { petUnmasteredPower } from '../../../shared/pet-ability-mastery';
import { petBattleJutsus } from '../../../shared/pet-battle-loadout';
import type { Pet } from '../types/pet';

/** Combat-only projection stays behind the battle screen's lazy boundary. */
export function petCombatDamage(pet: Pet): number {
    const bestDamageJutsu = Math.max(
        0,
        ...petBattleJutsus(pet, { forceProgression: true }).filter((jutsu) => jutsu.kind === 'damage').map((jutsu) => petUnmasteredPower(jutsu.power, jutsu.upgrade)),
    );
    // Power drives strikes. Vitality and Guard preserve the companion, while
    // Agility affects action timing rather than adding a second damage bonus.
    return Math.max(20, Math.floor(
        pet.attack * 1.25
        + bestDamageJutsu * 0.6
        + pet.level * 2,
    ));
}
