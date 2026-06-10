/*
 * Starter jutsu + bloodline content catalog.
 *
 *   • starterBloodlines / starterBloodlineOffense — the four starter bloodline
 *     names + their offense discipline
 *   • nonBloodlineTagTable + rebalanceNonBloodlineJutsu — the balanced tag
 *     loadout applied to every starter (non-bloodline) jutsu
 *   • starterJutsus — the full built-in starter jutsu catalog
 *   • starterSavedBloodlines — the four built-in admin bloodlines
 *
 * Built via the lib/jutsu builders; pure content otherwise. Extracted from
 * App.tsx (jutsu cluster, data layer).
 */

import { makeJutsu, normalizeJutsu } from "../lib/jutsu";
import { bloodlinePoints } from "../lib/jutsu-points";
import type { Jutsu, JutsuTag, SavedBloodline } from "../types/combat";
import type { JutsuType, JutsuElement, Rank, JutsuTarget, JutsuMethod } from "../types/core";

// Jutsu taxonomy dropdown options (moved from App.tsx; re-exported there for the
// "../App" import site in components/JutsuDropdownList).
export const specialties: JutsuType[] = ["Ninjutsu", "Taijutsu", "Genjutsu", "Bukijutsu", "Any"];
export const jutsuElements: JutsuElement[] = ["Earth", "Wind", "Lightning", "Fire", "Water", "None"];

export const starterBloodlines = ["Ashen Eyes", "Inferno Cataclysm", "Shadow Lotus", "Iron Fang"];

export const starterBloodlineOffense: Record<string, JutsuType> = {
    "Ashen Eyes": "Genjutsu",
    "Inferno Cataclysm": "Ninjutsu",
    "Shadow Lotus": "Bukijutsu",
    "Iron Fang": "Taijutsu",
};

// ── Non-bloodline (starter) balance table ────────────────────────────────
// Variant suffix → AP tier: a 1-tag entry is the 60AP damage variant; a 2-tag
// entry is a 40AP utility pair. Move stays on the two movement jutsu.
const nonBloodlineTagTable: Record<string, string[]> = {
    "starter-nin-earth-1": ["Shield", "Increase Damage Taken"],
    "starter-nin-earth-2": ["Ignition"],
    "starter-nin-earth-3": ["Lifesteal", "Recoil"],
    "starter-nin-wind-1": ["Increase Heal", "Increase Damage Given"],
    "starter-nin-wind-2": ["Recoil"],
    "starter-nin-wind-3": ["Increase Damage Taken", "Poison"],
    "starter-nin-lightning-1": ["Lifesteal", "Increase Damage Given"],
    "starter-nin-lightning-2": ["Wound"],
    "starter-nin-lightning-3": ["Drain", "Poison"],
    "starter-nin-fire-1": ["Shield", "Lifesteal"],
    "starter-nin-fire-2": ["Poison"],
    "starter-nin-fire-3": ["Reflect", "Increase Damage Given"],
    "starter-nin-water-1": ["Lifesteal", "Increase Damage Taken"],
    "starter-nin-water-2": ["Wound"],
    "starter-nin-water-3": ["Recoil", "Ignition"],

    "starter-tai-earth-1": ["Increase Damage Taken", "Ignition"],
    "starter-tai-earth-2": ["Poison"],
    "starter-tai-earth-3": ["Reflect", "Absorb"],
    "starter-tai-wind-1": ["Move", "Reflect"],
    "starter-tai-wind-2": ["Lifesteal"],
    "starter-tai-wind-3": ["Drain", "Poison"],
    "starter-tai-lightning-1": ["Shield", "Increase Damage Given"],
    "starter-tai-lightning-2": ["Reflect"],
    "starter-tai-lightning-3": ["Lifesteal", "Increase Damage Taken"],
    "starter-tai-fire-1": ["Decrease Damage Taken", "Decrease Damage Given"],
    "starter-tai-fire-2": ["Drain"],
    "starter-tai-fire-3": ["Ignition", "Recoil"],
    "starter-tai-water-1": ["Increase Heal", "Lifesteal"],
    "starter-tai-water-2": ["Increase Damage Given"],
    "starter-tai-water-3": ["Reflect", "Absorb"],

    "starter-gen-earth-1": ["Increase Damage Given", "Decrease Damage Taken"],
    "starter-gen-earth-2": ["Siphon"],
    "starter-gen-earth-3": ["Decrease Damage Given", "Drain"],
    "starter-gen-wind-1": ["Shield", "Absorb"],
    "starter-gen-wind-2": ["Siphon"],
    "starter-gen-wind-3": ["Move", "Decrease Damage Given"],
    "starter-gen-lightning-1": ["Absorb", "Drain"],
    "starter-gen-lightning-2": ["Decrease Damage Given"],
    "starter-gen-lightning-3": ["Recoil", "Ignition"],
    "starter-gen-fire-1": ["Increase Heal", "Decrease Damage Taken"],
    "starter-gen-fire-2": ["Siphon"],
    "starter-gen-fire-3": ["Reflect", "Increase Damage Taken"],
    "starter-gen-water-1": ["Increase Damage Given", "Drain"],
    "starter-gen-water-2": ["Poison"],
    "starter-gen-water-3": ["Decrease Damage Given", "Absorb"],

    "starter-buki-earth-1": ["Increase Heal", "Decrease Damage Given"],
    "starter-buki-earth-2": ["Wound"],
    "starter-buki-earth-3": ["Decrease Damage Taken", "Increase Damage Given"],
    "starter-buki-wind-1": ["Ignition", "Recoil"],
    "starter-buki-wind-2": ["Wound"],
    "starter-buki-wind-3": ["Decrease Damage Taken", "Reflect"],
    "starter-buki-lightning-1": ["Increase Heal", "Absorb"],
    "starter-buki-lightning-2": ["Siphon"],
    "starter-buki-lightning-3": ["Decrease Damage Taken", "Decrease Damage Given"],
    "starter-buki-fire-1": ["Poison", "Increase Damage Taken"],
    "starter-buki-fire-2": ["Wound"],
    "starter-buki-fire-3": ["Ignition", "Absorb"],
    "starter-buki-water-1": ["Shield", "Decrease Damage Taken"],
    "starter-buki-water-2": ["Siphon"],
    "starter-buki-water-3": ["Recoil", "Drain"],
};

// Flat-value or binary tags carry no percent; every other starter tag uses the
// uniform 30% creator value (which displays as 20% at mastery 0).
function nonBloodlineTagPercent(name: string): number {
    if (name === "Move" || name === "Shield" || name === "Drain") return 0;
    return 30;
}

export function rebalanceNonBloodlineJutsu(jutsu: Jutsu): Jutsu {
    const normalized = normalizeJutsu(jutsu);
    const tagNames = nonBloodlineTagTable[normalized.id];
    if (!tagNames) return normalized; // Flicker + any off-table jutsu untouched
    const ap = tagNames.length === 1 ? 60 : 40; // 1 tag = 60AP damage, 2 = 40AP utility
    const tags = tagNames.map((name) => ({ name, percent: nonBloodlineTagPercent(name) }));
    const isMove = tagNames.includes("Move");

    return normalizeJutsu({
        ...normalized,
        ap,
        range: isMove ? normalized.range : 4,
        cooldown: 7,
        effectPower: ap === 60 ? 36 : 0,
        chakraCost: ap === 60 ? 250 : 125,
        staminaCost: ap === 60 ? 250 : 125,
        tags,
    });
}

export const starterJutsus: Jutsu[] = [
    // All jutsus: stored EP=28 (base). PvP/PvE scales +0.2 per mastery level ? EP 38 at mastery 50. Tags stored at 30% ? displays as 20% at mastery 0 via effectiveTagPercent.
    makeJutsu("starter-nin-earth-1", "Stone Needle Volley", "Ninjutsu", 60, 4, 28, 1, 125, 125, [{ name: "Pierce", percent: 0 }], "Earth"),
    makeJutsu("starter-nin-earth-2", "Mud Coffin Bind", "Ninjutsu", 60, 3, 30, 3, 250, 250, [{ name: "Stun", percent: 0 }], "Earth"),
    makeJutsu("starter-nin-earth-3", "Iron Sand Burst", "Ninjutsu", 40, 3, 27, 2, 125, 125, [{ name: "Wound", percent: 18 }], "Earth"),
    makeJutsu("starter-nin-wind-1", "Vacuum Palm Wave", "Ninjutsu", 40, 5, 20, 1, 125, 125, [{ name: "Push", percent: 0 }], "Wind"),
    makeJutsu("starter-nin-wind-2", "Cyclone Cutter", "Ninjutsu", 60, 5, 30, 2, 250, 250, [{ name: "Increase Damage Given", percent: 18 }], "Wind"),
    makeJutsu("starter-nin-wind-3", "Gale Net Snare", "Ninjutsu", 40, 4, 18, 2, 125, 125, [{ name: "Decrease Damage Given", percent: 20 }], "Wind"),
    makeJutsu("starter-nin-lightning-1", "Static Fang", "Ninjutsu", 40, 4, 35, 1, 125, 125, [{ name: "Damage", percent: 100 }], "Lightning"),
    makeJutsu("starter-nin-lightning-2", "Thunderclap Lance", "Ninjutsu", 60, 5, 30, 2, 250, 250, [{ name: "Pierce", percent: 0 }], "Lightning"),
    makeJutsu("starter-nin-lightning-3", "Nerve Spark Seal", "Ninjutsu", 60, 3, 30, 3, 250, 250, [{ name: "Bloodline Seal", percent: 0 }], "Lightning"),
    makeJutsu("starter-nin-fire-1", "Cinder Shot", "Ninjutsu", 40, 4, 25, 1, 125, 125, [{ name: "Ignition", percent: 18 }], "Fire"),
    makeJutsu("starter-nin-fire-2", "Blazing Dragon Arc", "Ninjutsu", 60, 5, 30, 2, 250, 250, [{ name: "Increase Damage Taken", percent: 18 }], "Fire"),
    makeJutsu("starter-nin-fire-3", "Ash Cloud Breaker", "Ninjutsu", 40, 3, 23, 2, 125, 125, [{ name: "Poison", percent: 15 }], "Fire"),
    makeJutsu("starter-nin-water-1", "Tide Spear", "Ninjutsu", 40, 4, 33, 1, 125, 125, [{ name: "Damage", percent: 100 }], "Water"),
    makeJutsu("starter-nin-water-2", "Crashing Wave Prison", "Ninjutsu", 60, 3, 30, 3, 250, 250, [{ name: "Stun", percent: 0 }], "Water"),
    makeJutsu("starter-nin-water-3", "Mist Veil Flow", "Ninjutsu", 40, 0, 0, 2, 125, 125, [{ name: "Shield", percent: 0 }, { name: "Decrease Damage Taken", percent: 18 }], "Water"),

    makeJutsu("starter-tai-earth-1", "Granite Elbow", "Taijutsu", 40, 1, 35, 1, 125, 125, [{ name: "Damage", percent: 100 }], "Earth"),
    makeJutsu("starter-tai-earth-2", "Boulder Heel Drop", "Taijutsu", 60, 1, 30, 2, 250, 250, [{ name: "Increase Damage Given", percent: 16 }], "Earth"),
    makeJutsu("starter-tai-earth-3", "Rooted Guard Break", "Taijutsu", 60, 1, 26, 2, 125, 125, [{ name: "Pierce", percent: 0 }], "Earth"),
    makeJutsu("starter-tai-wind-1", "Tempest Step Kick", "Taijutsu", 40, 2, 20, 1, 125, 125, [{ name: "Move", percent: 0 }], "Wind"),
    makeJutsu("starter-tai-wind-2", "Rising Gale Combo", "Taijutsu", 60, 1, 30, 2, 250, 250, [{ name: "Increase Damage Taken", percent: 16 }], "Wind"),
    makeJutsu("starter-tai-wind-3", "Spiral Backfist", "Taijutsu", 40, 1, 21, 1, 125, 125, [{ name: "Push", percent: 0 }], "Wind"),
    makeJutsu("starter-tai-lightning-1", "Spark Jab Chain", "Taijutsu", 40, 1, 33, 1, 125, 125, [{ name: "Damage", percent: 100 }], "Lightning"),
    makeJutsu("starter-tai-lightning-2", "Raikou Knee Strike", "Taijutsu", 60, 1, 30, 2, 250, 250, [{ name: "Stun", percent: 0 }], "Lightning"),
    makeJutsu("starter-tai-lightning-3", "Flash Step Counter", "Taijutsu", 40, 1, 0, 3, 125, 125, [{ name: "Reflect", percent: 22 }], "Lightning"),
    makeJutsu("starter-tai-fire-1", "Burning Knuckle", "Taijutsu", 40, 1, 25, 1, 125, 125, [{ name: "Ignition", percent: 16 }], "Fire"),
    makeJutsu("starter-tai-fire-2", "Meteor Axe Kick", "Taijutsu", 60, 1, 30, 2, 250, 250, [{ name: "Recoil", percent: 10 }], "Fire"),
    makeJutsu("starter-tai-fire-3", "Cinder Rush", "Taijutsu", 40, 2, 26, 1, 125, 125, [{ name: "Wound", percent: 14 }], "Fire"),
    makeJutsu("starter-tai-water-1", "Flowing Palm", "Taijutsu", 40, 1, 28, 1, 125, 125, [{ name: "Lifesteal", percent: 18 }], "Water"),
    makeJutsu("starter-tai-water-2", "Tidal Shoulder Throw", "Taijutsu", 60, 1, 30, 2, 250, 250, [{ name: "Decrease Damage Given", percent: 18 }], "Water"),
    makeJutsu("starter-tai-water-3", "Ripple Guard Form", "Taijutsu", 40, 0, 0, 2, 125, 125, [{ name: "Shield", percent: 0 }, { name: "Cleanse Prevent", percent: 0 }], "Water"),

    makeJutsu("starter-gen-earth-1", "Stone Eye Mirage", "Genjutsu", 40, 4, 18, 2, 125, 125, [{ name: "Decrease Damage Given", percent: 18 }], "Earth"),
    makeJutsu("starter-gen-earth-2", "Buried Memory Field", "Genjutsu", 60, 4, 30, 3, 250, 250, [{ name: "Bloodline Seal", percent: 0 }], "Earth"),
    makeJutsu("starter-gen-earth-3", "Dust Puppet Vision", "Genjutsu", 40, 3, 24, 1, 125, 125, [{ name: "Poison", percent: 14 }], "Earth"),
    makeJutsu("starter-gen-wind-1", "Whispering Gale", "Genjutsu", 40, 5, 21, 1, 125, 125, [{ name: "Increase Damage Taken", percent: 16 }], "Wind"),
    makeJutsu("starter-gen-wind-2", "Hollow Voice Cyclone", "Genjutsu", 60, 5, 30, 2, 250, 250, [{ name: "Overclock", percent: 0 }], "Wind"),
    makeJutsu("starter-gen-wind-3", "Feather Step Illusion", "Genjutsu", 40, 0, 0, 2, 125, 125, [{ name: "Move", percent: 0 }, { name: "Decrease Damage Taken", percent: 16 }], "Wind"),
    makeJutsu("starter-gen-lightning-1", "Neural Flash", "Genjutsu", 40, 4, 32, 1, 125, 125, [{ name: "Damage", percent: 100 }], "Lightning"),
    makeJutsu("starter-gen-lightning-2", "Paralysis Theater", "Genjutsu", 60, 4, 30, 3, 250, 250, [{ name: "Stun", percent: 0 }], "Lightning"),
    makeJutsu("starter-gen-lightning-3", "Mirror Spark Dream", "Genjutsu", 40, 0, 0, 3, 125, 125, [{ name: "Mirror", percent: 22 }], "Lightning"),
    makeJutsu("starter-gen-fire-1", "Lantern Fear", "Genjutsu", 40, 4, 24, 1, 125, 125, [{ name: "Ignition", percent: 14 }], "Fire"),
    makeJutsu("starter-gen-fire-2", "Inferno Hallucination", "Genjutsu", 60, 4, 30, 2, 250, 250, [{ name: "Increase Damage Given", percent: 16 }], "Fire"),
    makeJutsu("starter-gen-fire-3", "Ashen Mind Lock", "Genjutsu", 40, 3, 18, 2, 125, 125, [{ name: "Buff Prevent", percent: 0 }], "Fire"),
    makeJutsu("starter-gen-water-1", "Drowning Reflection", "Genjutsu", 40, 4, 23, 1, 125, 125, [{ name: "Drain", percent: 0 }], "Water"),
    makeJutsu("starter-gen-water-2", "Moonlit Tide Dream", "Genjutsu", 60, 4, 30, 2, 250, 250, [{ name: "Decrease Damage Taken", percent: 20 }], "Water"),
    makeJutsu("starter-gen-water-3", "Mist Memory Snare", "Genjutsu", 40, 4, 20, 2, 125, 125, [{ name: "Clear Prevent", percent: 0 }], "Water"),

    makeJutsu("starter-buki-earth-1", "Stone Kunai Rain", "Bukijutsu", 40, 4, 32, 1, 125, 125, [{ name: "Damage", percent: 100 }], "Earth"),
    makeJutsu("starter-buki-earth-2", "Adamant Chain Pull", "Bukijutsu", 60, 4, 30, 2, 250, 250, [{ name: "Push", percent: 0 }], "Earth"),
    makeJutsu("starter-buki-earth-3", "Obsidian Edge", "Bukijutsu", 60, 2, 26, 1, 125, 125, [{ name: "Pierce", percent: 0 }], "Earth"),
    makeJutsu("starter-buki-wind-1", "Windmill Shuriken Line", "Bukijutsu", 40, 5, 27, 1, 125, 125, [{ name: "Wound", percent: 14 }], "Wind"),
    makeJutsu("starter-buki-wind-2", "Aerial Blade Fan", "Bukijutsu", 60, 5, 30, 2, 250, 250, [{ name: "Increase Damage Given", percent: 16 }], "Wind"),
    makeJutsu("starter-buki-wind-3", "Crosswind Needle", "Bukijutsu", 40, 5, 22, 1, 125, 125, [{ name: "Decrease Damage Taken", percent: 16 }], "Wind"),
    makeJutsu("starter-buki-lightning-1", "Charged Senbon", "Bukijutsu", 40, 5, 35, 1, 125, 125, [{ name: "Damage", percent: 100 }], "Lightning"),
    makeJutsu("starter-buki-lightning-2", "Thunder Wire Trap", "Bukijutsu", 60, 4, 30, 3, 250, 250, [{ name: "Stun", percent: 0 }], "Lightning"),
    makeJutsu("starter-buki-lightning-3", "Magnet Blade Return", "Bukijutsu", 40, 4, 22, 2, 125, 125, [{ name: "Reflect", percent: 20 }], "Lightning"),
    makeJutsu("starter-buki-fire-1", "Explosive Tag Flicker", "Bukijutsu", 40, 4, 25, 1, 125, 125, [{ name: "Ignition", percent: 16 }], "Fire"),
    makeJutsu("starter-buki-fire-2", "Flame Wire Detonation", "Bukijutsu", 60, 4, 30, 2, 250, 250, [{ name: "Increase Damage Taken", percent: 16 }], "Fire"),
    makeJutsu("starter-buki-fire-3", "Searing Blade Toss", "Bukijutsu", 40, 3, 23, 1, 125, 125, [{ name: "Poison", percent: 14 }], "Fire"),
    makeJutsu("starter-buki-water-1", "Mist Needle Spread", "Bukijutsu", 40, 5, 24, 1, 125, 125, [{ name: "Drain", percent: 0 }], "Water"),
    makeJutsu("starter-buki-water-2", "Torrent Chain Slash", "Bukijutsu", 60, 4, 30, 2, 250, 250, [{ name: "Siphon", percent: 16 }], "Water"),
    makeJutsu("starter-buki-water-3", "Hidden Current Guard", "Bukijutsu", 40, 0, 0, 2, 125, 125, [{ name: "Shield", percent: 0 }, { name: "Cleanse Prevent", percent: 0 }], "Water"),
    // Universal jutsus — no element, available to all
    normalizeJutsu({
        id: "starter-universal-flicker",
        name: "Flicker",
        type: "Taijutsu",
        element: "None",
        ap: 20,
        range: 5,
        effectPower: 1,
        cooldown: 2,
        chakraCost: 25,
        staminaCost: 25,
        target: "EMPTY_GROUND",
        method: "SINGLE",
        tags: [{ name: "Move", percent: 0 }],
        battleDescription: "%user vanishes and reappears on a nearby open tile.",
    }),
].map(rebalanceNonBloodlineJutsu);

function makeStarterBloodlineDamageJutsu(id: string, name: string, type: JutsuType, element: string, secondaryTag: JutsuTag): Jutsu {
    return makeJutsu(id, name, type, 60, 4, 30, 7, 100, 100, [secondaryTag], element as JutsuElement);
}

function makeStarterBloodlineUtilityJutsu(id: string, name: string, type: JutsuType, element: string, tags: JutsuTag[]): Jutsu {
    return makeJutsu(id, name, type, 40, 4, 0, 7, 100, 100, tags, element as JutsuElement);
}

export const starterSavedBloodlines: SavedBloodline[] = [
    {
        id: "starter-bloodline-ashen-eyes",
        name: "Ashen Eyes",
        rank: "A Rank" as Rank,
        specialElement: "Blood",
        lore: "A cursed kekkei genkai born from a clan that broke a forbidden pact with blood spirits. Those awakened by the Ashen Eyes see the world through a veil of crimson — perceiving every living being as a tapestry of veins and chakra pathways. The afflicted can shatter hallucinations directly into their opponent's bloodstream, weaponizing the very sight of life itself. Ancient texts warn that prolonged use slowly turns the user's own eyes the color of ash and bone.",
        jutsus: [
            makeStarterBloodlineDamageJutsu("ashen-eyes-blood-gaze", "Blood Gaze Rupture", "Genjutsu", "Blood", { name: "Wound", percent: 30 }),
            makeStarterBloodlineDamageJutsu("ashen-eyes-crimson-hall", "Crimson Hallucination", "Genjutsu", "Blood", { name: "Increase Damage Taken", percent: 35 }),
            makeStarterBloodlineDamageJutsu("ashen-eyes-vein-mirror", "Vein Mirror Nightmare", "Genjutsu", "Blood", { name: "Poison", percent: 30 }),
            makeStarterBloodlineUtilityJutsu("ashen-eyes-hematoma-veil", "Hematoma Veil", "Genjutsu", "Blood", [{ name: "Increase Damage Taken", percent: 30 }, { name: "Decrease Damage Given", percent: 30 }]),
        ],
        totalPoints: 9,
    },
    {
        id: "starter-bloodline-inferno-cataclysm",
        name: "Inferno Cataclysm",
        rank: "A Rank" as Rank,
        specialElement: "Lava",
        lore: "Forged in the volcanic rifts of the Ember Wastes, the Inferno Cataclysm lineage merges fire and earth chakra at the cellular level. The wielder's body temperature runs far above human limits — surface veins glow faintly orange in darkness. In battle, they can compress molten rock and superheated gas into devastating projectiles or coffin-like formations that entomb the enemy in cooling lava. Survivors of their attacks are found encased in obsidian, preserved like dark statues.",
        jutsus: [
            makeStarterBloodlineDamageJutsu("inferno-cataclysm-lava-burst", "Lava Burst Coffin", "Ninjutsu", "Lava", { name: "Ignition", percent: 30 }),
            makeStarterBloodlineDamageJutsu("inferno-cataclysm-molten-rain", "Molten Rainfall", "Ninjutsu", "Lava", { name: "Increase Damage Given", percent: 35 }),
            makeStarterBloodlineDamageJutsu("inferno-cataclysm-crater-lance", "Crater Lance", "Ninjutsu", "Lava", { name: "Wound", percent: 30 }),
            makeStarterBloodlineUtilityJutsu("inferno-cataclysm-obsidian-afterglow", "Obsidian Afterglow", "Ninjutsu", "Lava", [{ name: "Ignition", percent: 30 }, { name: "Decrease Damage Given", percent: 30 }]),
        ],
        totalPoints: 9,
    },
    {
        id: "starter-bloodline-shadow-lotus",
        name: "Shadow Lotus",
        rank: "A Rank" as Rank,
        specialElement: "Shadow",
        lore: "Descended from a sect of bukijutsu assassins who trained in perpetual darkness for generations, the Shadow Lotus bloodline channels shadow-natured chakra through weapons and thrown implements. Their techniques bloom like deadly flowers from the dark — blades that trail shadow-ribbons, senbon that multiply in dim light, and wires that vanish entirely in low visibility. Their clan temple has no lanterns. They say the darkness learned to fear them first.",
        jutsus: [
            makeStarterBloodlineDamageJutsu("shadow-lotus-umbra-senbon", "Umbra Senbon Bloom", "Bukijutsu", "Shadow", { name: "Poison", percent: 30 }),
            makeStarterBloodlineDamageJutsu("shadow-lotus-night-petal", "Night Petal Cutter", "Bukijutsu", "Shadow", { name: "Decrease Damage Taken", percent: 35 }),
            makeStarterBloodlineDamageJutsu("shadow-lotus-eclipse-wire", "Eclipse Wire Blossom", "Bukijutsu", "Shadow", { name: "Absorb", percent: 35 }),
            makeStarterBloodlineUtilityJutsu("shadow-lotus-black-petal-guard", "Black Petal Guard", "Bukijutsu", "Shadow", [{ name: "Decrease Damage Taken", percent: 30 }, { name: "Absorb", percent: 30 }]),
        ],
        totalPoints: 9,
    },
    {
        id: "starter-bloodline-iron-fang",
        name: "Iron Fang",
        rank: "A Rank" as Rank,
        specialElement: "Iron",
        lore: "A taijutsu bloodline born from miners who fused raw metallic chakra into their fighting style over ten generations. Iron Fang users can coat their limbs in magnetized iron-dense chakra, turning every punch and kick into a shattering impact that tears armor and breaks weapons. Their fists leave cracked stone. Some high-level users develop iron-grey patches on their knuckles, shins, and forearms — natural battle plating grown from within. The clan motto: 'The mountain doesn't dodge. It endures. Then it falls on you.'",
        jutsus: [
            makeStarterBloodlineDamageJutsu("iron-fang-ferrous-crash", "Ferrous Fang Crash", "Taijutsu", "Iron", { name: "Wound", percent: 30 }),
            makeStarterBloodlineDamageJutsu("iron-fang-steel-maw", "Steel Maw Breaker", "Taijutsu", "Iron", { name: "Increase Damage Given", percent: 35 }),
            makeStarterBloodlineDamageJutsu("iron-fang-magnet-knuckle", "Magnet Knuckle Rend", "Taijutsu", "Iron", { name: "Decrease Damage Taken", percent: 35 }),
            makeStarterBloodlineUtilityJutsu("iron-fang-anvil-breath", "Anvil Breath Guard", "Taijutsu", "Iron", [{ name: "Increase Damage Given", percent: 30 }, { name: "Decrease Damage Taken", percent: 30 }]),
        ],
        totalPoints: 9,
    },
].map((bloodline) => ({ ...bloodline, totalPoints: bloodlinePoints(bloodline.jutsus) }));

export const jutsuTargets: JutsuTarget[] = ["OPPONENT", "SELF", "OTHER_USER", "CHARACTER", "EMPTY_GROUND"];
export const jutsuMethods: JutsuMethod[] = ["SINGLE", "ALL", "AOE_CIRCLE", "INSTANT_EFFECT"];
export const bloodlineJutsuMethods: JutsuMethod[] = ["SINGLE", "AOE_CIRCLE", "INSTANT_EFFECT"];
export const instantEffectGroundTags = ["Decrease Damage Given", "Recoil", "Poison"];
export const fortyApBlockedBloodlineTags = ["Pierce", "Siphon", "Mirror", "Copy", "Wound"];
