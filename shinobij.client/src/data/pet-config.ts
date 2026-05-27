/*
 * Pet config tables — UI options, trait descriptions, training duration
 * tiers, expedition flavor pool, treat/feed item XP lookups.
 *
 * Pure data + one small lookup helper (petFeedXpForItem). No closures.
 *
 * Extracted from App.tsx.
 */

import type { PetRarity, PetTrait, PetTrainingType, PetExpeditionType } from "../types/pet";
import { TERRITORY_CONTROL_SCROLL_ID } from "../constants/game";

// ── Trait roster + descriptions ──────────────────────────────────────────

export const petTraits: PetTrait[] = ["Loyal", "Aggressive", "Guardian", "Swift", "Lucky", "Battleborn"];

export const petTraitDescriptions: Record<PetTrait, string> = {
    Loyal: "Pet trains 50% faster — gains more stats from every training session",
    Aggressive: "Pet spawns with +15% attack",
    Guardian: "Pet spawns with +20% HP & defense — reduces your incoming battle damage by 8% while active",
    Swift: "Pet spawns with +20% speed — you earn +25% XP from battles while active",
    Lucky: "You earn +20% ryo from battles while this pet is active",
    Battleborn: "Pet spawns with +10% to all stats",
};

// ── Training duration tiers + speed multipliers ─────────────────────────

export const petTrainingDurations = [
    { label: "15 minutes", ms: 15 * 60 * 1000 },
    { label: "1 hour", ms: 60 * 60 * 1000 },
    { label: "4 hours", ms: 4 * 60 * 60 * 1000 },
    { label: "8 hours", ms: 8 * 60 * 60 * 1000 },
] as const;

export const petRarityOrder: PetRarity[] = ["standard", "rare", "legendary", "mythic"];

export const petTrainingDurationMultipliers: Record<number, number> = {
    [15 * 60 * 1000]: 1,
    [60 * 60 * 1000]: 3,
    [4 * 60 * 60 * 1000]: 8,
    [8 * 60 * 60 * 1000]: 14,
};

export const petTrainingOptions: { type: PetTrainingType; label: string; desc: string }[] = [
    { type: "strength", label: "Strength Training", desc: "Boosts attack and pet XP" },
    { type: "endurance", label: "Endurance Training", desc: "Boosts HP, defense, and pet XP" },
    { type: "agility", label: "Agility Training", desc: "Boosts speed and pet XP" },
    { type: "chakra", label: "Chakra Training", desc: "Boosts jutsu power and pet XP" },
    { type: "bond", label: "Bond Training", desc: "Balanced stat growth, XP, and happiness" },
];

// ── Expedition options + flavor stories ─────────────────────────────────

export const petExpeditionOptions: { type: PetExpeditionType; label: string; durationMs: number; durationLabel: string; desc: string }[] = [
    { type: "scout", label: "Scout Routes", durationMs: 45 * 60 * 1000, durationLabel: "45m", desc: "Short ryo and pet XP trip." },
    { type: "forage", label: "Forage Wilds", durationMs: 2 * 60 * 60 * 1000, durationLabel: "2h", desc: "Balanced XP, stats, and material chance." },
    { type: "ruins", label: "Explore Old Ruins", durationMs: 4 * 60 * 60 * 1000, durationLabel: "4h", desc: "Long trip with best rare currency odds." },
];

export const petExpeditionStories: Record<PetExpeditionType, string[]> = {
    scout: [
        "darted between rooftops at dusk, trailing a suspicious courier across three districts",
        "mapped every guard post along the eastern ridge, leaving claw marks only you'd recognize",
        "tracked a faint chakra trail deep into the wetlands and found an abandoned supply cache",
        "ran the outer wall circuit four times, timing every patrol rotation to the second",
        "spotted a rival clan scout and shadowed them all the way back to their camp — undetected",
        "intercepted a courier pigeon mid-flight and returned with the message still sealed",
        "scouted the canyon pass at night, memorizing every shadow and hidden alcove",
    ],
    forage: [
        "wrestled a river boar for its catch, won decisively, and came home smelling like adventure",
        "found a hidden spring deep in the crimson forest, guarded by territorial serpents — still collected",
        "spent the afternoon beneath a waterfall dodging falling rocks and rival scavengers",
        "unearthed old battle-marked coins half-buried beneath a gnarled root near the northern ridge",
        "dug through three collapsed burrows before finding a cache of strange glowing herbs",
        "traded stares with a mountain wolf for twenty minutes, then calmly took what was needed",
        "foraged through a fog-drenched valley, returning with roots and seeds no market stocks",
    ],
    ruins: [
        "descended into a crumbling shrine and emerged carrying relics no map has ever marked",
        "triggered an ancient ward trap, survived the blast, and looted whatever was sealed behind it",
        "navigated collapsed stone corridors by instinct alone — and found something waiting at the end",
        "spent hours reading sealing scripts carved into walls most shinobi are too afraid to approach",
        "slipped through a flooded lower chamber and resurfaced holding something that hummed faintly",
        "found a sealed door, opened it somehow, and returned with a look that says 'don't ask'",
        "explored a forgotten battlefield beneath the ruins — the bones were old; the chakra was not",
    ],
};

// ── Pet feed / treat item tables ────────────────────────────────────────

export const petTreatItems = [
    { id: "pet-treat", name: "Treats", xp: 100 },
    { id: "elemental-pet-treat", name: "Elemental Treats", xp: 250 },
    { id: "ancient-pet-treat", name: "Ancient Treats", xp: 500 },
] as const;

export const petFeedItems = [
    ...petTreatItems,
    { id: "golden-apple", name: "Golden Apple", xp: 2000 },
] as const;

// Items that stack in inventory (consumables, scrolls, dungeon shards).
// All petFeedItems are stackable plus 4 hand-picked special-case ids.
export const stackableItemIds = new Set<string>([
    ...petFeedItems.map((item) => item.id),
    TERRITORY_CONTROL_SCROLL_ID,
    "hollow-gate-key",
    "dungeon-legendary-fragment",
    "veil-of-the-hollow",
]);

export function petFeedXpForItem(itemId?: string): number | undefined {
    return petFeedItems.find((item) => item.id === itemId)?.xp;
}
