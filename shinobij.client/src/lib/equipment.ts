/*
 * Equipment helpers — slot normalization, slot display labels, armor
 * quality damage-reduction lookup.
 *
 * Two const tables (itemSectionOptions, armorQualityTiers) live here
 * alongside the helpers that consume them. Both tables are also
 * referenced from the AdminPanel + Profile screens; App.tsx re-exports
 * them so existing in-file references keep working without an import.
 *
 * Pure data + pure functions. No closures, no React.
 *
 * Extracted from App.tsx.
 */

import type { EquipmentSlot, EquipmentSlots, ArmorQuality, GameItem } from "../types/combat";

// Canonical equipment slots + their human-readable labels. Aliases like
// "weapon" / "armor" / "accessory" are normalised by normalizeEquipmentSlot
// below before any lookup against this list.
//
// "hand" holds the weapon; "gloves" is a SEPARATE hand so a weapon and
// gloves/gauntlets can be worn together (the two slots used to collide on
// "hand", with whichever was equipped last evicting the other). Gloves are
// detected/routed by equipSlotForItem below — a glove ITEM keeps its existing
// slot ("hand" + a glove/gauntlet name) so older saved gloves still register.
export const itemSectionOptions: ReadonlyArray<{ value: EquipmentSlot; label: string }> = [
    { value: "aura", label: "Aura" },
    { value: "hand", label: "Hand" },
    { value: "gloves", label: "Gloves" },
    { value: "body", label: "Body" },
    { value: "waist", label: "Waist" },
    { value: "legs", label: "Legs" },
    { value: "feet", label: "Feet" },
    { value: "head", label: "Head" },
    { value: "item", label: "Item" },
    { value: "thrown", label: "Thrown" },
    { value: "potion", label: "Potion" },
];

// A hand-slot item whose name marks it as gloves/gauntlets (rather than a
// weapon). Matches the same /glove|gauntlet/i test isArmorOrGloveItem uses, so
// existing named gloves (forged onto the "hand" slot) are recognised with no
// data migration. An item authored directly on the "gloves" slot also counts.
export function isGloveItem(item: Pick<GameItem, "slot" | "name">): boolean {
    const normalized = normalizeEquipmentSlot(item.slot);
    if (normalized === "gloves") return true;
    return normalized === "hand" && /glove|gauntlet/i.test(item.name);
}

// The equipment-map KEY an item occupies. Gloves split off the weapon hand
// onto the dedicated "gloves" slot; everything else uses its normalised slot.
// Use this (not normalizeEquipmentSlot) anywhere an item is being equipped,
// matched against a slot, or labelled by its destination slot.
export function equipSlotForItem(item: Pick<GameItem, "slot" | "name">): EquipmentSlot {
    return isGloveItem(item) ? "gloves" : normalizeEquipmentSlot(item.slot);
}

// Map legacy slot aliases onto the canonical 9 slot values. The save format
// has carried some "weapon"/"armor"/"accessory" entries from an older
// equipment design; this collapses them into the slot the rest of the
// engine expects.
export function normalizeEquipmentSlot(slot: EquipmentSlot): EquipmentSlot {
    if (slot === "weapon") return "hand";
    if (slot === "armor") return "body";
    if (slot === "accessory") return "aura";
    return slot;
}

// Display labels for slot KEYS that aren't authoring options in
// itemSectionOptions (above). The three combat-item keys share the canonical
// "item" authoring slot, so their per-slot labels live here instead.
const SLOT_LABEL_OVERRIDES: Partial<Record<EquipmentSlot, string>> = {
    item1: "Item 1",
    item2: "Item 2",
    item3: "Item 3",
};

export function equipmentSlotLabel(slot: EquipmentSlot): string {
    const normalized = normalizeEquipmentSlot(slot);
    return SLOT_LABEL_OVERRIDES[normalized]
        ?? itemSectionOptions.find((option) => option.value === normalized)?.label
        ?? normalized;
}

// ── Combat item slots (Attack/Defense Pill, Smoke Bomb) ──────────────────────
// A combat item is AUTHORED on the canonical "item" slot (so item data and the
// admin item editor stay unchanged), but it EQUIPS into one of three dedicated
// keys so all three can be carried at once. Equipping is a non-consuming
// SELECTION — the inventory stack is the ammo, spent per use in battle. The
// legacy bare "item" key is kept for back-compat: an old save that stored a
// single combat item there still resolves until the Inventory migration re-homes
// it into item1.
export const COMBAT_ITEM_SLOTS: readonly EquipmentSlot[] = ["item1", "item2", "item3"];

// Equipment KEYS that feed the in-battle action bar AND the per-fight consumable
// budget: weapon hand, throwable, the three combat-item slots, the potion — plus
// the legacy "weapon"/"item" aliases so a not-yet-migrated save still loads.
export const combatLoadoutSlots: EquipmentSlot[] = [
    "hand", "weapon", "thrown", "item1", "item2", "item3", "item", "potion",
];

// The subset of equipment keys whose contents are SPENT on use (selections, not
// worn gear): throwable + the three item slots + potion (+ legacy "item").
// Equipping/unequipping these never drains or mints an inventory stack.
export const combatConsumableSlots: EquipmentSlot[] = [
    "thrown", "item1", "item2", "item3", "item", "potion",
];

// True when `slot` is one of the combat-item KEYS (incl. the legacy bare "item").
export function isCombatItemSlot(slot: EquipmentSlot): boolean {
    return slot === "item" || slot === "item1" || slot === "item2" || slot === "item3";
}

// A combat consumable item — authored on the "item" slot AND carrying a combat
// field (an action AP cost, a weapon effect, or weapon EP). This distinguishes
// the real combat items (Attack/Defense Pill, Smoke Bomb) from the other
// slot-"item" entries (pet food, hunting/forge materials, collars, pet gear),
// which are NOT player-equippable into a combat slot.
export function isCombatConsumable(item: Pick<GameItem, "slot" | "weaponEffect" | "apCost" | "weaponEp">): boolean {
    return normalizeEquipmentSlot(item.slot) === "item"
        && (item.weaponEffect != null || item.apCost != null || item.weaponEp != null);
}

// ── Combat-consumable hold caps (single shared pool) ─────────────────────────
// Throwables, combat items, and potions use ONE pool: what you OWN is what
// battle spends. The shop bulk-buy clamps purchases to these caps, and the
// inventory equip slots show how many are left (emptying out at zero). Caps are
// per item id — you can hold up to 50 of EACH combat item across the three
// item slots, 50 of a throwable, and 2 potions (matching the 2-use/battle cap).
export const THROWN_HOLD_CAP = 50;
export const COMBAT_ITEM_HOLD_CAP = 50;
export const POTION_HOLD_CAP = 2;

// The most a player may hold of a given combat consumable, or null when the
// item isn't one of the three capped categories (throwable / combat item /
// potion). Pet food, scrolls, keys, crafting materials etc. return null and
// stay uncapped, unchanged from before.
export function consumableHoldCap(
    item: Pick<GameItem, "slot" | "weaponEffect" | "apCost" | "weaponEp" | "restoreChakra" | "restoreStamina">,
): number | null {
    const slot = normalizeEquipmentSlot(item.slot);
    if (slot === "potion") return POTION_HOLD_CAP;
    if (slot === "thrown") return THROWN_HOLD_CAP;
    if (slot === "item" && (isCombatConsumable(item) || item.restoreChakra != null || item.restoreStamina != null)) {
        return COMBAT_ITEM_HOLD_CAP;
    }
    return null;
}

// Place a combat item id into the three item KEYS without evicting the others:
// keep it where it already sits, else the first open slot, else replace item1.
// Returns a NEW equipment map and retires the legacy bare "item" key on any
// (re)equip. Never drains an inventory stack — combat items are non-consuming
// selections spent in battle.
export function equipCombatItem(equipment: EquipmentSlots, itemId: string): EquipmentSlots {
    const next: EquipmentSlots = { ...equipment };
    delete next.item;
    const existing = COMBAT_ITEM_SLOTS.find((s) => next[s] === itemId);
    const dest = existing ?? COMBAT_ITEM_SLOTS.find((s) => !next[s]) ?? "item1";
    for (const s of COMBAT_ITEM_SLOTS) if (s !== dest && next[s] === itemId) delete next[s];
    next[dest] = itemId;
    return next;
}

// ── Armor quality damage reduction ───────────────────────────────────────

export const armorQualityTiers: ReadonlyArray<{ quality: ArmorQuality; reduction: number; label: string }> = [
    { quality: "Standard",   reduction: 0.01, label: "Standard — 1% damage reduction" },
    { quality: "Reinforced", reduction: 0.03, label: "Reinforced — 3% damage reduction" },
    { quality: "Rare",       reduction: 0.05, label: "Rare — 5% damage reduction" },
    { quality: "Elite",      reduction: 0.06, label: "Elite — 6% damage reduction" },
    { quality: "Legendary",  reduction: 0.07, label: "Legendary — 7% damage reduction" },
    { quality: "Mythic",     reduction: 0.08, label: "Mythic — 8% damage reduction" },
];

export function armorReductionForQuality(quality?: ArmorQuality): number {
    return armorQualityTiers.find((t) => t.quality === quality)?.reduction ?? 0;
}

// ── Item bonus display consolidation ─────────────────────────────────────
// Items can grant up to 8 specialty stats (Ninjutsu/Taijutsu/Bukijutsu/
// Genjutsu × Offense/Defense). Without consolidation, an endgame relic
// shows 8 nearly-identical "Effect N: Increase X Offense / Defense"
// cards stacked in the popup. When all 4 offense (or defense) entries
// have the same value, we collapse them into a single "All Offense +N"
// (or "All Defense +N") line.
//
// Caller passes a bonuses map and gets back an ordered list of
// { stat, value } entries ready for display — stat is the final display
// label (camelCase already converted to "Title Case", or "All Offense"/
// "All Defense" when collapsed).
export function consolidateItemBonuses(
    bonuses: Record<string, unknown> | null | undefined,
    options: { excludeStats?: ReadonlySet<string> } = {},
): Array<{ stat: string; value: number }> {
    const exclude = options.excludeStats ?? new Set<string>();
    const entries = Object.entries(bonuses ?? {})
        .filter(([stat, value]) =>
            typeof value === "number" && value !== 0 && !exclude.has(stat),
        ) as Array<[string, number]>;

    const OFFENSE = ["ninjutsuOffense", "taijutsuOffense", "bukijutsuOffense", "genjutsuOffense"];
    const DEFENSE = ["ninjutsuDefense", "taijutsuDefense", "bukijutsuDefense", "genjutsuDefense"];

    const lines: Array<{ stat: string; value: number }> = [];
    const consumed = new Set<string>();

    function tryCollapse(keys: string[], label: string) {
        const found = keys.map((k) => entries.find(([s]) => s === k));
        // All four must be present AND share the same value.
        if (found.every((f) => f != null) && found.every((f) => f![1] === found[0]![1])) {
            lines.push({ stat: label, value: found[0]![1] });
            for (const k of keys) consumed.add(k);
        }
    }

    tryCollapse(OFFENSE, "All Offense");
    tryCollapse(DEFENSE, "All Defense");

    // Pretty labels for the armor-effect bonus keys — without these,
    // "absorbPercent" would render as "Absorb Percent" which reads awkwardly.
    const NICE_LABELS: Record<string, string> = {
        absorbPercent:   "Absorb",
        reflectPercent:  "Reflect",
        lifeStealPercent: "Life Steal",
        damagePercent:   "Increase Damage",
        shield:          "Shield",
    };

    for (const [stat, value] of entries) {
        if (consumed.has(stat)) continue;
        const label = NICE_LABELS[stat]
            // camelCase → "Title Case" fallback (e.g. "ninjutsuOffense" → "Ninjutsu Offense")
            ?? stat.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());
        lines.push({ stat: label, value });
    }

    return lines;
}
