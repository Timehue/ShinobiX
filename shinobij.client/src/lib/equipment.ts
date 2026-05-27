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

import type { EquipmentSlot, ArmorQuality } from "../types/combat";

// Canonical equipment slots + their human-readable labels. Aliases like
// "weapon" / "armor" / "accessory" are normalised by normalizeEquipmentSlot
// below before any lookup against this list.
export const itemSectionOptions: ReadonlyArray<{ value: EquipmentSlot; label: string }> = [
    { value: "aura", label: "Aura" },
    { value: "hand", label: "Hand" },
    { value: "body", label: "Body" },
    { value: "waist", label: "Waist" },
    { value: "legs", label: "Legs" },
    { value: "feet", label: "Feet" },
    { value: "head", label: "Head" },
    { value: "item", label: "Item" },
    { value: "thrown", label: "Thrown" },
];

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

export function equipmentSlotLabel(slot: EquipmentSlot): string {
    const normalized = normalizeEquipmentSlot(slot);
    return itemSectionOptions.find((option) => option.value === normalized)?.label ?? normalized;
}

// ── Armor quality damage reduction ───────────────────────────────────────

export const armorQualityTiers: ReadonlyArray<{ quality: ArmorQuality; reduction: number; label: string }> = [
    { quality: "Standard",   reduction: 0.01, label: "Standard — 1% damage reduction" },
    { quality: "Reinforced", reduction: 0.03, label: "Reinforced — 3% damage reduction" },
    { quality: "Rare",       reduction: 0.05, label: "Rare — 5% damage reduction" },
    { quality: "Elite",      reduction: 0.06, label: "Elite — 6% damage reduction" },
    { quality: "Legendary",  reduction: 0.07, label: "Legendary — 7% damage reduction" },
];

export function armorReductionForQuality(quality?: ArmorQuality): number {
    return armorQualityTiers.find((t) => t.quality === quality)?.reduction ?? 0;
}
