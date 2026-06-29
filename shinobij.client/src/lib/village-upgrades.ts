/*
 * Village upgrade system — definitions, per-character upgrade levels/bonuses,
 * costs, and the derived bonus helpers (training XP, jutsu speed, shop/hospital
 * discounts, bank interest, etc.) that fold in the elder-focus modifier.
 *
 * Pure functions depending only on lib/utils + the type modules.
 * Extracted from App.tsx (Region A).
 */

import { clampNumber } from "./utils";
import { clanUpgradeEffectPercent } from "./clan-upgrades";
import { doctrineShopDiscount, doctrineHospitalDiscount, doctrineXpBonus } from "./clan-doctrines";
import type { Character } from "../types/character";
import type { VillageUpgrades, VillageUpgradeKey } from "../types/core";

export const VILLAGE_UPGRADE_MAX_LEVEL = 50;

export const villageUpgradeDefinitions: Array<{
    key: VillageUpgradeKey;
    name: string;
    icon: string;
    perLevel: number;
    unit: "%";
    description: string;
}> = [
        { key: "training", name: "Training Grounds", icon: "💪", perLevel: 0.25, unit: "%", description: "+0.25% character XP from stat training per level." },
        { key: "jutsuTraining", name: "Jutsu Training", icon: "📖", perLevel: 0.25, unit: "%", description: "+0.25% jutsu training speed / jutsu XP per level." },
        { key: "shop", name: "Shop", icon: "🛒", perLevel: 0.25, unit: "%", description: "0.25% shop discount per level." },
        { key: "townDefense", name: "Town Defense", icon: "🏯", perLevel: 0.1, unit: "%", description: "+0.1% defense vs Genjutsu, Taijutsu, Bukijutsu, and Ninjutsu while defending through the Village Guard queue." },
        { key: "petYard", name: "Pet Yard", icon: "🐾", perLevel: 0.25, unit: "%", description: "+0.25% pet XP from pet training per level." },
        { key: "bank", name: "Bank", icon: "🏦", perLevel: 0.01, unit: "%", description: "+0.01% daily bank interest per level (max 0.5%/day at level 50)." },
        { key: "missionHall", name: "Mission Hall", icon: "📜", perLevel: 0.5, unit: "%", description: "+0.5% XP, ryo, and stamina mission rewards per level." },
        { key: "hospital", name: "Hospital", icon: "⚕️", perLevel: 1, unit: "%", description: "1% hospital discount per level." },
    ];

export function defaultVillageUpgrades(): VillageUpgrades {
    return {
        training: 0,
        jutsuTraining: 0,
        shop: 0,
        townDefense: 0,
        petYard: 0,
        bank: 0,
        missionHall: 0,
        hospital: 0,
    };
}

export function normalizeVillageUpgrades(upgrades?: Partial<VillageUpgrades>): VillageUpgrades {
    const defaults = defaultVillageUpgrades();
    const normalized = { ...defaults, ...(upgrades ?? {}) } as VillageUpgrades;
    for (const key of Object.keys(defaults) as VillageUpgradeKey[]) {
        normalized[key] = clampNumber(Math.floor(Number(normalized[key] ?? 0)), 0, VILLAGE_UPGRADE_MAX_LEVEL);
    }
    return normalized;
}

export function getVillageUpgrades(character: Character): VillageUpgrades {
    return normalizeVillageUpgrades(character.villageUpgrades);
}

export function villageUpgradeLevel(character: Character, key: VillageUpgradeKey): number {
    return getVillageUpgrades(character)[key] ?? 0;
}

export function villageUpgradeBonus(character: Character, key: VillageUpgradeKey): number {
    const def = villageUpgradeDefinitions.find((upgrade) => upgrade.key === key);
    return villageUpgradeLevel(character, key) * (def?.perLevel ?? 0);
}

export function boostAmount(amount: number, percent: number) {
    return Math.max(0, Math.floor(amount * (1 + percent / 100)));
}

export function discountCost(cost: number, percent: number) {
    return Math.max(1, Math.floor(cost * Math.max(0, 1 - percent / 100)));
}

export function villageUpgradeCost(key: VillageUpgradeKey, currentLevel: number) {
    const base: Record<VillageUpgradeKey, number> = {
        training: 10,
        jutsuTraining: 12,
        shop: 12,
        townDefense: 14,
        petYard: 12,
        bank: 16,
        missionHall: 14,
        hospital: 12,
    };
    return Math.floor((base[key] ?? 12) + currentLevel * 4 + Math.pow(currentLevel, 1.25) * 2);
}

// Clan member-passive bonus, read from the clan-upgrade-levels snapshot stamped
// on the character (Clan Hall load). Additive on top of village-upgrade +
// elder-focus bonuses, so existing players (no clan) are unaffected.
function clanBonus(character: Character, key: "trainingGrounds" | "petDen" | "medicalWing" | "blacksmith"): number {
    return clanUpgradeEffectPercent(key, character.clanUpgradeLevels?.[key] ?? 0);
}
export function getTrainingXpBonus(character: Character) { return villageUpgradeBonus(character, "training") + (character.elderFocus === "training" ? 10 : 0) + clanBonus(character, "trainingGrounds") + doctrineXpBonus(character.clanDoctrine ?? "none"); }
export function getJutsuTrainingSpeedBonus(character: Character) { return villageUpgradeBonus(character, "jutsuTraining") + (character.elderFocus === "training" ? 10 : 0); }
export function getShopDiscountPercent(character: Character) { return villageUpgradeBonus(character, "shop") + (character.elderFocus === "trade" ? 5 : 0) + clanBonus(character, "blacksmith") + doctrineShopDiscount(character.clanDoctrine ?? "none"); }
export function getTownDefenseGuardBonus(character: Character) { return villageUpgradeBonus(character, "townDefense"); }
export function getPetXpBonus(character: Character) { return villageUpgradeBonus(character, "petYard") + clanBonus(character, "petDen"); }
export function getBankInterestPercent(character: Character) { return villageUpgradeBonus(character, "bank"); }
export function getMissionRewardBonus(character: Character) { return villageUpgradeBonus(character, "missionHall") + doctrineXpBonus(character.clanDoctrine ?? "none"); }
export function getHospitalDiscountPercent(character: Character) { return villageUpgradeBonus(character, "hospital") + clanBonus(character, "medicalWing") + doctrineHospitalDiscount(character.clanDoctrine ?? "none"); }
