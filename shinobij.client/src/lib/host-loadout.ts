import { getBloodlineMultiplier } from "./combat-math";
import { getAllItems } from "./items";
import { stripDataUrlImages } from "./pvp-session";
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
        // Without inline item art. An item forged this session keeps its upload
        // inline until the next load (a still image up to ~270 KB of base64, an
        // animated one ~2.7 MB), and this loadout goes to Tower, Clan Boss, World
        // Boss and World Crisis starts, parsed under the server's 256 KB default
        // body limit (api/_body-limits.ts): two fresh forges were enough for a
        // 413. Every server consumer re-resolves the items from the fighter's
        // save, and the PvP create drops `data:image` the same way.
        pvpItems: stripDataUrlImages(getPvpItemLoadout(character, items)) as GameItem[],
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
