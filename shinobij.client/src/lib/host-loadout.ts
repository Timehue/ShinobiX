import { getBloodlineMultiplier } from "./combat-math";
import { getAllItems } from "./items";
import {
    getCharacterArmorFactor,
    getCharacterArmorRawDR,
    getEquippedItemBonus,
    getPvpItemLoadout,
} from "./equipment-stats";
import type { TowerHostLoadout } from "./towers-api";
import type { Character } from "../types/character";
import type { GameItem, SavedBloodline } from "../types/combat";

export function buildHostLoadout(
    character: Character,
    savedBloodlines: SavedBloodline[],
    creatorItems: GameItem[],
): TowerHostLoadout {
    const items = getAllItems(creatorItems);
    return {
        pvpItems: getPvpItemLoadout(character, items),
        bloodlineMult: getBloodlineMultiplier(character, savedBloodlines),
        armorFactor: getCharacterArmorFactor(character, items),
        armorRawDR: getCharacterArmorRawDR(character, items),
        itemDamagePct: getEquippedItemBonus(character, items, "damagePercent"),
        itemAbsorbPct: getEquippedItemBonus(character, items, "absorbPercent"),
        itemReflectPct: getEquippedItemBonus(character, items, "reflectPercent"),
        itemLifeStealPct: getEquippedItemBonus(character, items, "lifeStealPercent"),
        itemShield: getEquippedItemBonus(character, items, "shield"),
    };
}
