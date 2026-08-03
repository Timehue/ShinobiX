import type { Character } from "../types/character";
import type { GameItem, SavedBloodline } from "../types/combat";
import type { TowerHostLoadout } from "./towers-api";
import { getAllItems } from "./items";
import { getBloodlineMultiplier } from "./combat-math";
import {
    getPvpItemLoadout,
    getCharacterArmorFactor,
    getCharacterArmorRawDR,
    getEquippedItemBonus,
} from "./equipment-stats";

/**
 * The equipment-derived combat extras the SAVE does not persist — pvpItems plus
 * the armor / bloodline / item passives. Without them the server-sealed fighter
 * clamps to no-bonus defaults and the player fights the encounter without their
 * armor or bloodline multiplier, which is why Battle Towers, Anbu and combat
 * missions all send this on /start too.
 *
 * Its own module: combat-math imports back from ../App, so keeping this out of
 * lib/ai-fight-api leaves that module (and lib/ai-fight-settle above it) free of
 * the App back-edge and therefore loadable under node's test runner.
 */
export function aiFightHostLoadout(
    character: Character,
    creatorItems?: GameItem[],
    savedBloodlines?: SavedBloodline[],
): TowerHostLoadout {
    const items = getAllItems(creatorItems ?? []);
    return {
        pvpItems: getPvpItemLoadout(character, items),
        bloodlineMult: getBloodlineMultiplier(character, savedBloodlines ?? []),
        armorFactor: getCharacterArmorFactor(character, items),
        armorRawDR: getCharacterArmorRawDR(character, items),
        itemDamagePct: getEquippedItemBonus(character, items, "damagePercent"),
        itemAbsorbPct: getEquippedItemBonus(character, items, "absorbPercent"),
        itemReflectPct: getEquippedItemBonus(character, items, "reflectPercent"),
        itemLifeStealPct: getEquippedItemBonus(character, items, "lifeStealPercent"),
        itemShield: getEquippedItemBonus(character, items, "shield"),
    };
}
