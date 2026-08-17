import { LEGENDARY_WAR_CRATE_ID } from "../constants/game";
import type { GameItem } from "../types/combat";
import { isCombatConsumable, isGloveItem, normalizeEquipmentSlot } from "./equipment";

export type ItemPresentation = {
    category: string;
    use: string;
    showPlayerSlot: boolean;
    effectLabel: string;
};

export function presentItem(item: GameItem, petFoodXp?: number): ItemPresentation {
    const slot = normalizeEquipmentSlot(item.slot);
    const searchable = `${item.id} ${item.name} ${item.description}`.toLowerCase();
    const weapon = slot === "hand" && !isGloveItem(item);
    const armor = item.armorQuality != null
        || isGloveItem(item)
        || ["head", "body", "waist", "legs", "feet"].includes(slot);
    const petGear = slot === "item" && /pet battle|pet companion|pet's .*slot|pet collar/.test(searchable);
    const craftingMaterial = slot === "item" && (/^hunt-/.test(searchable)
        || /crafting material|used (?:in|to) (?:the )?(?:crafter|forge)|forg(?:e|ing) .*weapon|craft points|combine fragments/.test(searchable));
    const keyItem = slot === "item" && /\bkey\b|\bscroll\b|evolution|awakening stone|ascension stone/.test(searchable);

    if (item.id === LEGENDARY_WAR_CRATE_ID) {
        return { category: "Reward Crate", use: "Open from backpack", showPlayerSlot: false, effectLabel: "Contents" };
    }
    if (petFoodXp) {
        return { category: "Pet Training Item", use: "Feed in Pet Yard", showPlayerSlot: false, effectLabel: "Training Effect" };
    }
    if (slot === "potion") {
        return { category: "Combat Potion", use: "Equip, then drink in battle", showPlayerSlot: true, effectLabel: "Effect" };
    }
    if (slot === "thrown") {
        return { category: "Throwable", use: "Equip, then use in battle", showPlayerSlot: true, effectLabel: "Impact Effect" };
    }
    if (isCombatConsumable(item)) {
        return { category: "Battle Item", use: "Equip to a battle-item slot", showPlayerSlot: true, effectLabel: "Effect" };
    }
    if (weapon) {
        return { category: "Weapon", use: "Equip to fight in PvE and PvP", showPlayerSlot: true, effectLabel: "Weapon Trait" };
    }
    if (armor) {
        return { category: "Armor", use: "Wear for passive protection", showPlayerSlot: true, effectLabel: "Armor Trait" };
    }
    if (slot === "aura") {
        return { category: "Aura Equipment", use: "Equip for passive bonuses", showPlayerSlot: true, effectLabel: "Aura Effect" };
    }
    if (slot === "relic") {
        return { category: "Relic", use: "Equip for passive bonuses", showPlayerSlot: true, effectLabel: "Relic Effect" };
    }
    if (petGear) {
        return { category: "Pet Gear", use: "Manage in Pet Yard", showPlayerSlot: false, effectLabel: "Pet Effect" };
    }
    if (craftingMaterial) {
        return { category: "Crafting Material", use: "Spend in the Crafter", showPlayerSlot: false, effectLabel: "Crafting Use" };
    }
    if (keyItem) {
        return { category: "Key Item", use: "Spend at its related activity", showPlayerSlot: false, effectLabel: "Unlocks" };
    }
    if (slot === "item") {
        return { category: "Utility Item", use: "Used by its related activity", showPlayerSlot: false, effectLabel: "Effect" };
    }
    return { category: "Equipment", use: "Equip for passive bonuses", showPlayerSlot: true, effectLabel: "Equipment Effect" };
}

export function formatItemBonus(stat: string, value: number) {
    const isPercent = /Absorb|Reflect|Life Steal|Increase Damage/.test(stat);
    return `${value > 0 ? "+" : ""}${value}${isPercent ? "%" : ""}`;
}
