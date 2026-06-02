/**
 * Combat-relevant stats derived from a character's equipped gear (and the one
 * active-pet trait that modifies PvE armor). Extracted verbatim from App.tsx
 * with no behavior change. Pure functions: character + item catalog in,
 * number / loadout out.
 */
import { armorReductionForQuality } from "./equipment";
import type { Character } from "../types/character";
import type { PetTrait } from "../types/pet";
import type { GameItem, EquipmentSlot } from "../types/combat";

export function getActivePetTrait(character: Character): PetTrait | undefined {
    return character.pets?.find((p) => p.id === character.activePetId)?.trait;
}

export function getCharacterArmorFactor(character: Character, allItems: GameItem[]): number {
    const armorSlots: EquipmentSlot[] = ["head", "body", "armor", "waist", "legs", "feet"];
    let totalReduction = 0;
    for (const slot of armorSlots) {
        const id = character.equipment?.[slot];
        if (!id) continue;
        const item = allItems.find((i) => i.id === id);
        if (item?.armorQuality) totalReduction += armorReductionForQuality(item.armorQuality);
    }
    if (getActivePetTrait(character) === "Guardian") totalReduction += 0.08;
    return Math.max(0.25, 1 - totalReduction);
}

// PvP-specific: returns raw DR sum (no hard floor) so the server's soft DR pool
// can give diminishing returns across armor slots. Pets deliberately excluded
// from PvP — their Guardian trait only applies in PvE via getCharacterArmorFactor.
// 1 legendary piece = 0.07, full 6-slot legendary = 0.42.
export function getCharacterArmorRawDR(character: Character, allItems: GameItem[]): number {
    const armorSlots: EquipmentSlot[] = ["head", "body", "armor", "waist", "legs", "feet"];
    let totalReduction = 0;
    for (const slot of armorSlots) {
        const id = character.equipment?.[slot];
        if (!id) continue;
        const item = allItems.find((i) => i.id === id);
        if (item?.armorQuality) totalReduction += armorReductionForQuality(item.armorQuality);
    }
    // No pet Guardian bonus here — pets do not affect PvP combat.
    return Math.min(1.5, totalReduction);
}

export function getEquippedItemBonus<K extends keyof NonNullable<GameItem["bonuses"]>>(
    character: Character,
    allItems: GameItem[],
    field: K
): number {
    const allSlots = Object.values(character.equipment ?? {}) as string[];
    let total = 0;
    for (const id of allSlots) {
        const item = allItems.find((i) => i.id === id);
        if (item) total += (item.bonuses[field] as number | undefined) ?? 0;
    }
    return total;
}

export function getPvpItemLoadout(character: Character, allItems: GameItem[]): GameItem[] {
    const equippedIds = new Set(Object.values(character.equipment ?? {}).filter((id): id is string => Boolean(id)));
    return allItems.filter((item) => equippedIds.has(item.id));
}
