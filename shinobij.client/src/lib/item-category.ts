/*
 * Backpack item categorization — sorts every GameItem (and the handful of
 * legacy string / uncatalogued entries) into one small, stable category so the
 * Inventory screen can offer category tabs: Gear / Consumables / Pet /
 * Materials / Event.
 *
 * GameItem has no `category` field, so this DERIVES the category from the
 * item's slot plus a few known id sets/prefixes. Keep this the single source of
 * truth for "which backpack tab does an item belong to" — the counts and the
 * filtered grid both key off it, so every entry must map to exactly one
 * category (the function is total) or the per-tab counts won't sum to "All".
 *
 * Pure classification, no state. Leaf module — safe to import from anywhere.
 */

import type { GameItem } from "../types/combat";
import { isCombatConsumable, normalizeEquipmentSlot } from "./equipment";
import { petFeedXpForItem } from "../data/pet-config";
import {
    TERRITORY_CONTROL_SCROLL_ID,
    WEEKLY_BOSS_CORE_ID,
    DUNGEON_KEY_ID,
    DUNGEON_LEGENDARY_RELIC_ID,
    DUNGEON_LEGENDARY_FRAGMENT_ID,
    VEIL_OF_THE_HOLLOW_ID,
    HOLLOW_GATE_KEY_ID,
    WARFORGED_RELIC_ID,
    LEGENDARY_WAR_CRATE_ID,
} from "../constants/game";

export type ItemCategory = "gear" | "consumable" | "pet" | "material" | "event";

// Event / access / reward tokens — earned from live events, clan wars, and
// dungeons and then SPENT to *do* something: claim a sector, open a crate,
// enter a dungeon run. This is the "Event" tab. Kept distinct from the forging
// relics below (which are crafting inputs, not spend tokens).
const EVENT_ITEM_IDS: ReadonlySet<string> = new Set([
    TERRITORY_CONTROL_SCROLL_ID, // spend to claim/reinforce sectors
    DUNGEON_KEY_ID,              // spend to enter a Hidden Dungeon run
    HOLLOW_GATE_KEY_ID,          // spend to enter the Hollow Gate Shrine
    LEGENDARY_WAR_CRATE_ID,      // open for loot
]);

// Forging relics — special boss/war/dungeon drops CONSUMED at the Crafter to
// forge epic/legendary weapons ("used to forge…"). Despite their event origin
// they are crafting materials, so they live under "Materials" alongside the
// routine hunting drops — not the Event tab, which is for spend/access tokens.
const FORGE_MATERIAL_IDS: ReadonlySet<string> = new Set([
    WEEKLY_BOSS_CORE_ID,
    WARFORGED_RELIC_ID,
    DUNGEON_LEGENDARY_RELIC_ID,
    DUNGEON_LEGENDARY_FRAGMENT_ID,
    VEIL_OF_THE_HOLLOW_ID,
]);

// Pet-only id prefixes: glow collars, PVP/PVE companion gear, battle
// consumables, and evolution stones. Treats/feed items are caught separately
// via petFeedXpForItem. Within the item catalog these prefixes are unique to
// pet gear, so a prefix match is safe.
const PET_ID_PREFIXES = ["collar-", "pvp-", "pve-", "consum-", "evo-stone-"] as const;

// Equippable player gear — weapons, armor, accessories, throwables. Everything
// here goes under "Gear"; slot "item"/"potion" are handled before this check.
const GEAR_SLOTS: ReadonlySet<string> = new Set([
    "head", "body", "waist", "legs", "feet", "hand", "gloves", "aura", "thrown",
]);

/**
 * Classify a single backpack entry. `entry` is the raw id/name key; `item` is
 * its catalog match (absent for legacy string pills or an uncatalogued named
 * weapon). Total: always returns exactly one category.
 */
export function itemCategory(entry: string, item?: GameItem): ItemCategory {
    // Event tokens win over the generic "item" slot they share with pet gear
    // and materials, so a Weekly Boss Core lands under Event, not Materials.
    if (EVENT_ITEM_IDS.has(entry)) return "event";

    if (petFeedXpForItem(entry) != null) return "pet";
    if (PET_ID_PREFIXES.some((prefix) => entry.startsWith(prefix))) return "pet";

    if (FORGE_MATERIAL_IDS.has(entry) || entry.startsWith("hunt-") || entry === "legendary-material") return "material";

    // No catalog entry: fall back to id/name heuristics.
    if (!item) {
        if (entry === "Soldier Pill" || entry === "Chakra Pill") return "consumable";
        if (entry.startsWith("named-weapon")) return "gear";
        return "material";
    }

    const slot = normalizeEquipmentSlot(item.slot);
    if (slot === "potion") return "consumable";
    if (isCombatConsumable(item)) return "consumable"; // Attack/Defense Pill, Smoke Bomb
    if (GEAR_SLOTS.has(slot)) return "gear";

    // Remaining slot-"item" entries that aren't event/pet/material/consumable
    // (uncommon leftovers) bucket into Materials as the safe catch-all.
    return "material";
}

// Display order + chrome for the category tab strip. "All" is rendered
// separately by the screen; this is the ordered list of real categories.
export const ITEM_CATEGORY_ORDER: readonly ItemCategory[] = [
    "gear", "consumable", "pet", "material", "event",
];

export const ITEM_CATEGORY_META: Record<ItemCategory, { label: string; icon: string; empty: string }> = {
    gear:       { label: "Gear",        icon: "⚔️", empty: "No weapons or armor in your backpack." },
    consumable: { label: "Consumables", icon: "🧪", empty: "No consumables. Buy potions and combat items from the Shop." },
    pet:        { label: "Pet",         icon: "🐾", empty: "No pet items. Buy treats and gear from the Shop or Grand Marketplace." },
    material:   { label: "Materials",   icon: "🔨", empty: "No crafting materials. Hunt beasts and gather drops to fill the Crafter." },
    event:      { label: "Event",       icon: "🎟️", empty: "No event items yet. Earn them from weekly bosses, clan wars, and dungeon runs." },
};

// Rarity sort weight — higher sorts first, so the grid leads with the rarest
// gear. Unknown/absent rarity sinks to the bottom.
const RARITY_WEIGHT: Record<string, number> = {
    mythic: 6, legendary: 5, epic: 4, rare: 3, uncommon: 2, common: 1,
};

export function rarityWeight(rarity?: string): number {
    return rarity ? RARITY_WEIGHT[rarity] ?? 0 : 0;
}
