/*
 * Pet config tables — UI options, trait descriptions, training duration
 * tiers, expedition flavor pool, treat/feed item XP lookups.
 *
 * Pure data + one small lookup helper (petFeedXpForItem). No closures.
 *
 * Extracted from App.tsx.
 */

import type { Pet, PetRarity, PetTrait, PetTrainingType, PetExpeditionType } from "../types/pet";
import { PET_EXPEDITION_ROUTES } from "../../../shared/pet-expedition-contract";
import { RESOURCE_ITEMS } from '../../../shared/resource-items';
import { STACKED_MATERIAL_IDS } from "../../../shared/stacked-materials";
import {
    TERRITORY_CONTROL_SCROLL_ID,
    DUNGEON_KEY_ID,
    LEGENDARY_WAR_CRATE_ID,
    HOLLOW_BEAST_CACHE_ID,
    WARFORGED_RELIC_ID,
    DUNGEON_LEGENDARY_RELIC_ID,
} from "../constants/game";

// ── Trait roster + descriptions ──────────────────────────────────────────

export const petTraits: PetTrait[] = ["Loyal", "Aggressive", "Guardian", "Swift", "Lucky", "Battleborn"];

/** Shrine apex traits. Kept separate so ordinary acquisition rolls cannot mint them. */
export const ultraPetTraits: PetTrait[] = ["Fateweaver", "Hollowborn", "Boonbringer"];

/* What each trait does, by battle system. "Coliseum battles" means every fight
   on the Showdown engine (Coliseum, Ladder, Pet Arena, wild, story, dungeon,
   war and the First Pact; api/_pet-showdown/engine.ts TRAIT_FX). "Warfront" is
   the real-time Rite (pet-duel-cinematic.ts). Stat bonuses are baked in when
   the pet is acquired. */
export const petTraitDescriptions: Record<PetTrait, string> = {
    Loyal: "Earns 50% more XP from every completed training timer. In Coliseum battles it charges its signature meter 20% faster.",
    Aggressive: "+15% attack. Deals 6% more damage in Coliseum battles and fights more aggressively in Warfront.",
    Guardian: "+20% HP and defense. Its guard blocks more damage in Coliseum battles. Outside PvP it also cuts your incoming battle damage by 8% while active.",
    Swift: "+20% speed. Acts 8% faster in Coliseum battles and dodges more in Warfront.",
    Lucky: "You earn 15 extra ryo for each ordinary fight or PvP win while this pet is active. Ordinary fights have a pay ceiling, so the bonus fades out at high level. Its damage rolls run slightly higher in Coliseum battles, and it lands more critical hits in Warfront.",
    Battleborn: "+10% to all stats. Starts Coliseum battles with 25 signature meter already charged.",
    Fateweaver: "Apex · +20% to all stats. In Coliseum battles it deals 8% more damage and charges its meter 10% faster. In Warfront it has 18% dodge, more critical hits, and immunity to freeze and confusion.",
    Hollowborn: "Apex · +5% to all stats. In Coliseum battles it drains 8% of the damage it deals. In Warfront it deals 12% more damage, drains 12%, and lands more critical hits.",
    Boonbringer: "Apex · doubles rewards and pet XP from pet expeditions. In Coliseum battles it strengthens its ally synergy bonus by 20%.",
};

// ── Training duration tiers + sealed XP ─────────────────────────────────

export const petTrainingDurations = [
    { label: "15 minutes", ms: 15 * 60 * 1000 },
    { label: "1 hour", ms: 60 * 60 * 1000 },
    { label: "4 hours", ms: 4 * 60 * 60 * 1000 },
    { label: "8 hours", ms: 8 * 60 * 60 * 1000 },
] as const;

export const petRarityOrder: PetRarity[] = ["standard", "rare", "legendary", "mythic"];

export const petTrainingDurationMultipliers: Record<number, number> = {
    [15 * 60 * 1000]: 30,
    [60 * 60 * 1000]: 110,
    [4 * 60 * 60 * 1000]: 400,
    [8 * 60 * 60 * 1000]: 760,
};

// Timed training grants XP. Leveling supplies automatic core growth and Growth
// Points, so the timer choice never silently decides the pet's permanent build.
export const petTrainingOptions: { type: PetTrainingType; label: string; desc: string }[] = [
    { type: "bond", label: "Companion Training", desc: "Earn XP now; assign Growth Points after leveling" },
];

// ── Expedition options + flavor stories ─────────────────────────────────

export const petExpeditionOptions: { type: PetExpeditionType; label: string; durationMs: number; durationLabel: string; desc: string }[] = [
    "scout", "forage", "ruins",
].map((type) => ({
    type: type as PetExpeditionType,
    label: PET_EXPEDITION_ROUTES[type as PetExpeditionType].label,
    durationMs: PET_EXPEDITION_ROUTES[type as PetExpeditionType].durationMinutes * 60_000,
    durationLabel: PET_EXPEDITION_ROUTES[type as PetExpeditionType].durationLabel,
    desc: PET_EXPEDITION_ROUTES[type as PetExpeditionType].description,
}));

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
// All petFeedItems are stackable plus a few hand-picked special-case ids.
export const stackableItemIds = new Set<string>([
    ...RESOURCE_ITEMS.map(item => item.id),
    ...petFeedItems.map((item) => item.id),
    "beast-seal-worn", "beast-seal-reinforced", "beast-seal-tempered",
    "beast-seal-master", "beast-seal-ancient",
    TERRITORY_CONTROL_SCROLL_ID,
    "hollow-gate-key",
    "dungeon-legendary-fragment",
    "veil-of-the-hollow",
    "elemental-shard",
    "elemental-core",
    // High-volume consumables / throwables / reward materials. These are the
    // items players accumulate in bulk, so they live as counted stacks in
    // Character.itemStacks (one entry each) instead of one inventory[] slot per
    // copy — which is what used to overflow the 500-entry save cap and silently
    // drop newly-picked-up items. Evolution stones are deliberately NOT here:
    // the evolve paths key off inventory[], so each stone stays one entry there
    // (they still buy in bulk, see petSupplyHoldCap below).
    DUNGEON_KEY_ID,
    LEGENDARY_WAR_CRATE_ID,
    HOLLOW_BEAST_CACHE_ID,
    WARFORGED_RELIC_ID,
    DUNGEON_LEGENDARY_RELIC_ID,
    // Anbu Vault Infiltration war caches (server-minted; cap 9999/stack).
    // KEEP IN SYNC with api/_anbu-infiltration.ts CACHE_ITEM_IDS.
    "war-supply-cache", "war-resource-cache",
    // Village Stores rations (cooked in bulk, donated in bulk).
    "gather-field-herb",
    "gather-binding-fiber",
    "gather-iron-sand",
    "gather-heartwood-bark",
    "gather-shadow-thread",
    "gather-rime-crystal",
    "gather-ember-ore",
    "gather-stormglass-shard",
    "village-supply-bundle",
    "village-supply-crate",
    "ration-pack",
    "thrown-shuriken", "thrown-senbon", "thrown-serpent-dust",
    "item-smoke-bomb", "item-attack-pill", "item-defense-pill",
    "potion-rejuvenation",
    // Hunt materials and the Weekly Boss Core (owner ruling A12, 2026-10
    // rebalance): one shared list, which the server's save fold and grants use too.
    ...STACKED_MATERIAL_IDS,
]);

export function petFeedXpForItem(itemId?: string): number | undefined {
    return petFeedItems.find((item) => item.id === itemId)?.xp;
}

// ── Glow collars ─────────────────────────────────────────────────────────
// Ten cosmetic pet collars, one per glow color, sold in the Grand Marketplace
// for Fate Shards. Equip one in a pet's Collar slot (Pet Yard) to tint the
// pet's battle aura — visible in pet battles and when the pet is summoned into
// a PvE fight. Fields:
//   glow   — CSS color for the drop-shadow / box-shadow halo (exposed as the
//            --collar-glow var)
//   tint   — human color word used in the shop description
//   rarity — legendary (common colors) or mythic (rarer colors); must be one
//            of these two so the collar surfaces in the Grand Marketplace
//   cost   — price in Fate Shards. Cheapest is 50; rarer colors cost more.
// Unlock-style cosmetics: buy once, then equip on any pet for free.
//   prismatic — true for the animated rainbow collar. Its glow cycles through
//               every hue instead of using a single `glow` color. It is the top
//               rung of the Fate Shard ladder (2026-10 item-use pass: at cost 0
//               it had no source but an admin grant).
export type PetCollar = {
    id: string;
    name: string;
    tint: string;
    glow: string;
    rarity: "legendary" | "mythic";
    cost: number;
    prismatic?: boolean;
};

export const petCollars: PetCollar[] = [
    { id: "collar-crimson",   name: "Emberheart Collar",  tint: "crimson",            glow: "rgba(248, 113, 113, 0.95)", rarity: "legendary", cost: 50 },
    { id: "collar-amber",     name: "Sunflare Collar",    tint: "golden amber",       glow: "rgba(251, 191, 36, 0.95)",  rarity: "legendary", cost: 50 },
    { id: "collar-emerald",   name: "Thornwood Collar",   tint: "emerald",            glow: "rgba(52, 211, 153, 0.95)",  rarity: "legendary", cost: 50 },
    { id: "collar-azure",     name: "Skywarden Collar",   tint: "azure",              glow: "rgba(96, 165, 250, 0.95)",  rarity: "legendary", cost: 50 },
    { id: "collar-inferno",   name: "Wildfire Collar",    tint: "fiery orange",       glow: "rgba(251, 146, 60, 0.95)",  rarity: "legendary", cost: 80 },
    { id: "collar-verdant",   name: "Meadowlight Collar", tint: "lime",               glow: "rgba(163, 230, 53, 0.95)",  rarity: "legendary", cost: 80 },
    { id: "collar-rose",      name: "Blossom Collar",     tint: "rose-pink",          glow: "rgba(244, 114, 182, 0.95)", rarity: "mythic",    cost: 120 },
    { id: "collar-tidal",     name: "Riptide Collar",     tint: "teal",               glow: "rgba(45, 212, 191, 0.95)",  rarity: "mythic",    cost: 120 },
    { id: "collar-amethyst",  name: "Twilight Collar",    tint: "amethyst",           glow: "rgba(192, 132, 252, 0.95)", rarity: "mythic",    cost: 200 },
    { id: "collar-void",      name: "Voidpulse Collar",   tint: "violet void",        glow: "rgba(232, 121, 249, 0.95)", rarity: "mythic",    cost: 300 },
    { id: "collar-prismatic", name: "Prismatic Collar",   tint: "shifting prismatic", glow: "rgba(255, 255, 255, 0.95)", rarity: "mythic",    cost: 400, prismatic: true },
];

export const petCollarIds: ReadonlySet<string> = new Set(petCollars.map((c) => c.id));

export function petCollarById(collarId?: string): PetCollar | undefined {
    return collarId ? petCollars.find((c) => c.id === collarId) : undefined;
}

// Visual treatment for an equipped collar id: the glow color (falls back to a
// soft gold for legacy/unknown ids so an old save still glows) and whether it
// animates through the prismatic rainbow. Returns undefined when no collar.
export function petCollarVisual(collarId?: string): { glow: string; prismatic: boolean } | undefined {
    if (!collarId) return undefined;
    const collar = petCollarById(collarId);
    return { glow: collar?.glow ?? "rgba(250, 204, 21, 0.9)", prismatic: !!collar?.prismatic };
}

// ── PVP battle gear ──────────────────────────────────────────────────────
// Pet-battle-themed gear equipped in a pet's PVP slot, applied to BOTH
// combatants — from their own loadout — during a pet arena battle. Every effect
// is pure and loadout-driven, so both clients in a synced battle compute the
// identical result and deterministic ranked/PvP fights stay in sync.
//
// Two kinds of effect:
//   • Passive stat mods — atkPct/defPct/hpPct/spdPct (may be negative for
//     trade-off gear). Applied to the pet's stats at battle start via
//     applyPetPvpGear.
//   • Combat procs/conditionals — read live by the battle sim:
//       shieldStartPctOfHp   — start the fight with a shield = % of max HP
//       dotOnHitPctOfAtk(+Rounds) — basic-attack hits poison the foe for % of
//                              the attacker's ATK per round (default 2 rounds)
//       executeBelowPct/executeBonusPct — +% damage vs foes below an HP% line
//       lastStandBelowPct/lastStandReductionPct — % less damage taken while
//                              the wearer is below an HP% line
//       lifestealPctOfDamage — heal % of basic-attack damage dealt
// Sold in the Grand Marketplace (Aura / Accessory) for Fate Shards — rarity is
// legendary/mythic so it surfaces there. Unlock-style: buy once, equip on any
// pet. `desc` is shown in the shop and the loadout picker.
export type PetPvpGear = {
    id: string;
    name: string;
    rarity: "legendary" | "mythic";
    cost: number;
    desc: string;
    atkPct?: number;
    defPct?: number;
    hpPct?: number;
    spdPct?: number;
    shieldStartPctOfHp?: number;
    dotOnHitPctOfAtk?: number;
    dotOnHitRounds?: number;
    executeBelowPct?: number;
    executeBonusPct?: number;
    lastStandBelowPct?: number;
    lastStandReductionPct?: number;
    lifestealPctOfDamage?: number;
};

export const petPvpGear: PetPvpGear[] = [
    { id: "pvp-spiked-war-harness",     name: "Spiked War Harness",       rarity: "legendary", cost: 100, desc: "+15% Attack",                                  atkPct: 15 },
    { id: "pvp-ironhide-barding",       name: "Ironhide Barding",         rarity: "legendary", cost: 100, desc: "+15% Defense",                                 defPct: 15 },
    { id: "pvp-berserkers-muzzle",      name: "Berserker's Muzzle",       rarity: "legendary", cost: 110, desc: "+25% Attack, −12% Defense",                    atkPct: 25, defPct: -12 },
    { id: "pvp-tortoise-shell-plating", name: "Tortoise Shell Plating",   rarity: "legendary", cost: 110, desc: "+25% Defense, −12% Attack",                    defPct: 25, atkPct: -12 },
    { id: "pvp-aegis-pendant",          name: "Aegis Pendant",            rarity: "legendary", cost: 120, desc: "Start each battle with a shield (25% max HP)",  shieldStartPctOfHp: 25 },
    { id: "pvp-venomfang-bit",          name: "Venomfang Bit",            rarity: "mythic",    cost: 130, desc: "Basic attacks poison the foe for 2 rounds",     dotOnHitPctOfAtk: 30, dotOnHitRounds: 2 },
    { id: "pvp-executioners-talon",     name: "Executioner's Talon",      rarity: "mythic",    cost: 140, desc: "+30% damage to foes below 40% HP",             executeBelowPct: 40, executeBonusPct: 30 },
    { id: "pvp-final-bastion-charm",    name: "Final Bastion Charm",      rarity: "mythic",    cost: 140, desc: "−30% damage taken while below 30% HP",         lastStandBelowPct: 30, lastStandReductionPct: 30 },
    { id: "pvp-bloodthirster-fang",     name: "Bloodthirster Fang",       rarity: "mythic",    cost: 140, desc: "Heal 15% of basic-attack damage dealt",        lifestealPctOfDamage: 15 },
    { id: "pvp-arena-champion-regalia", name: "Arena Champion's Regalia", rarity: "mythic",    cost: 150, desc: "+10% to all stats",                            atkPct: 10, defPct: 10, hpPct: 10, spdPct: 10 },
];

export function petPvpGearById(gearId?: string): PetPvpGear | undefined {
    return gearId ? petPvpGear.find((g) => g.id === gearId) : undefined;
}

// Apply the pet's equipped PVP gear stat modifiers (passive atk/def/hp/spd).
// Pure + deterministic: a pet with no PVP gear (or an unknown id) is returned
// unchanged. Stats stay >= 1. Not re-capped — gear is a deliberate boost. The
// proc effects below are read live by the sim, not folded in here.
export function applyPetPvpGear(pet: Pet): Pet {
    const gear = petPvpGearById(pet.loadout?.pvp);
    if (!gear) return pet;
    const scale = (base: number, pct?: number) => pct ? Math.max(1, Math.round(base * (1 + pct / 100))) : base;
    return {
        ...pet,
        attack:  scale(pet.attack,  gear.atkPct),
        defense: scale(pet.defense, gear.defPct),
        hp:      scale(pet.hp,      gear.hpPct),
        speed:   scale(pet.speed,   gear.spdPct),
    };
}

// ── PVP gear combat procs (read live by the pet battle sim) ──────────────
// All pure and driven by the pet's own loadout, so synced battles stay
// deterministic. maxHp passed in is the pet's (gear-scaled) hp.

/** Flat shield HP granted at battle start (0 if none). */
export function petGearStartShield(pet: Pet): number {
    const g = petPvpGearById(pet.loadout?.pvp);
    return g?.shieldStartPctOfHp ? Math.max(1, Math.round(pet.hp * g.shieldStartPctOfHp / 100)) : 0;
}

/** Outgoing-damage multiplier from the attacker's execute gear vs a low-HP foe. */
export function petGearExecuteMult(attacker: Pet, targetHp: number, targetMaxHp: number): number {
    const g = petPvpGearById(attacker.loadout?.pvp);
    if (g?.executeBelowPct && g.executeBonusPct && targetMaxHp > 0 && (targetHp / targetMaxHp) * 100 < g.executeBelowPct) {
        return 1 + g.executeBonusPct / 100;
    }
    return 1;
}

/** Incoming-damage multiplier from the defender's last-stand gear while low. */
export function petGearLastStandMult(defender: Pet, selfHp: number, selfMaxHp: number): number {
    const g = petPvpGearById(defender.loadout?.pvp);
    if (g?.lastStandBelowPct && g.lastStandReductionPct && selfMaxHp > 0 && (selfHp / selfMaxHp) * 100 < g.lastStandBelowPct) {
        return Math.max(0.1, 1 - g.lastStandReductionPct / 100);
    }
    return 1;
}

/** DoT to stamp on the foe after a basic-attack hit (null if none). */
export function petGearDotOnHit(attacker: Pet): { damage: number; rounds: number } | null {
    const g = petPvpGearById(attacker.loadout?.pvp);
    if (!g?.dotOnHitPctOfAtk) return null;
    return { damage: Math.max(1, Math.round(attacker.attack * g.dotOnHitPctOfAtk / 100)), rounds: g.dotOnHitRounds ?? 2 };
}

/** HP to heal the attacker for, given basic-attack damage dealt (0 if none). */
export function petGearLifestealHeal(attacker: Pet, damageDealt: number): number {
    const g = petPvpGearById(attacker.loadout?.pvp);
    return g?.lifestealPctOfDamage ? Math.max(1, Math.floor(damageDealt * g.lifestealPctOfDamage / 100)) : 0;
}

// ── PVE companion gear ───────────────────────────────────────────────────
// Gear equipped in a pet's PVE slot. Unlike PVP gear (pet-vs-pet arena), these
// boost the pet when it's SUMMONED into a PvE ninja fight — read live by the
// summon logic (runSummonedPetAction in regular combat, bossPetFollowUp in the
// story boss). PvE is single-player, so no determinism constraints.
//   summonDmgPct          — flat % bonus to the summoned pet's attack damage
//   loyalty               — the pet never backfires (always strikes the foe)
//   healOnSummonPctOfMaxHp— heal you % of max HP when you summon the pet
//   playerLifestealPct    — heal you % of the damage your pet deals the foe
//   executeBelowPct/Bonus — +% summon damage vs foes below an HP% line
//   avengerBelowPct/Bonus — +% summon damage while YOU are below an HP% line
// These are CONSUMABLE gear: equipping installs the piece with a durability of
// PET_PVE_DURABILITY summons, and it breaks (is destroyed) once spent. Crafted
// in the Crafter (Supplies tab) from the exact ingredients in
// shared/crafting-recipes.ts, or bought for ryo in the Shop (Aura / Accessory) —
// they are NOT in the Grand Marketplace. `cost` = ryo Shop price. `desc` shows
// in the shop, crafter, and loadout picker.
export const PET_PVE_DURABILITY = 20;

export type PetPveGear = {
    id: string;
    name: string;
    rarity: "rare" | "epic";
    cost: number;       // ryo Shop price (expensive — these are consumable)
    /** @deprecated Retired craft-point price. The Crafter spends the exact recipe
     *  in shared/crafting-recipes.ts and nothing reads this field. */
    craftPts: number;
    desc: string;
    summonDmgPct?: number;
    loyalty?: boolean;
    healOnSummonPctOfMaxHp?: number;
    playerLifestealPct?: number;
    executeBelowPct?: number;
    executeBonusPct?: number;
    avengerBelowPct?: number;
    avengerBonusPct?: number;
};

export const petPveGear: PetPveGear[] = [
    { id: "pve-hunters-bond-harness", name: "Hunter's Bond Harness", rarity: "epic", cost: 4800, craftPts: 280, desc: "+20% summon damage",                              summonDmgPct: 20 },
    { id: "pve-loyal-companion-bell", name: "Loyal Companion Bell",  rarity: "epic", cost: 4800, craftPts: 280, desc: "Your pet never backfires (always strikes the foe)", loyalty: true },
    { id: "pve-frenzy-claw",          name: "Frenzy Claw",           rarity: "epic", cost: 5600, craftPts: 350, desc: "+30% summon damage",                              summonDmgPct: 30 },
    { id: "pve-guardians-blessing",   name: "Guardian's Blessing",   rarity: "epic", cost: 5600, craftPts: 350, desc: "Restore 15% of your max HP when you summon",       healOnSummonPctOfMaxHp: 15 },
    { id: "pve-sanguine-charm",       name: "Sanguine Charm",        rarity: "epic", cost: 6400, craftPts: 350, desc: "Heal for 20% of your pet's attack damage",         playerLifestealPct: 20 },
    { id: "pve-predators-fang",       name: "Predator's Fang",       rarity: "epic", cost: 7200, craftPts: 420, desc: "+35% summon damage to foes below 40% HP",          executeBelowPct: 40, executeBonusPct: 35 },
    // 4000 (2026-10 item-use pass): at 7200 it lost to the 5600-ryo Frenzy Claw,
    // which pays the same +30% at every HP, not only below 30%.
    { id: "pve-avengers-pendant",     name: "Avenger's Pendant",     rarity: "epic", cost: 4000, craftPts: 420, desc: "+30% summon damage while you're below 30% HP",     avengerBelowPct: 30, avengerBonusPct: 30 },
    { id: "pve-bloodbond-totem",      name: "Bloodbond Totem",       rarity: "epic", cost: 8000, craftPts: 420, desc: "Heal for 35% of your pet's attack damage",         playerLifestealPct: 35 },
    { id: "pve-pack-alpha-crest",     name: "Pack Alpha Crest",      rarity: "epic", cost: 8800, craftPts: 490, desc: "+18% summon damage and your pet never backfires",   summonDmgPct: 18, loyalty: true },
    { id: "pve-apex-predator-fang",   name: "Apex Predator Fang",    rarity: "epic", cost: 9600, craftPts: 490, desc: "+25% summon damage, +25% more vs foes below 40% HP", summonDmgPct: 25, executeBelowPct: 40, executeBonusPct: 25 },
];

// PVE gear is consumable (breaks after PET_PVE_DURABILITY summons), so it
// stacks in inventory — you can hold, buy, and craft multiple copies.
petPveGear.forEach((g) => stackableItemIds.add(g.id));

export function petPveGearById(gearId?: string): PetPveGear | undefined {
    return gearId ? petPveGear.find((g) => g.id === gearId) : undefined;
}

// Total summon-damage multiplier for the equipped PVE gear, folding in the
// flat bonus plus the execute (foe low) and avenger (you low) conditionals.
export function petPveSummonDamageMult(pet: Pet, enemyHpPct: number, playerHpPct: number): number {
    const g = petPveGearById(pet.loadout?.pve);
    if (!g) return 1;
    let mult = 1 + (g.summonDmgPct ?? 0) / 100;
    if (g.executeBelowPct && g.executeBonusPct && enemyHpPct < g.executeBelowPct) mult *= 1 + g.executeBonusPct / 100;
    if (g.avengerBelowPct && g.avengerBonusPct && playerHpPct < g.avengerBelowPct) mult *= 1 + g.avengerBonusPct / 100;
    return mult;
}

/** True if the equipped PVE gear stops the summoned pet from ever backfiring. */
export function petPveLoyalty(pet: Pet): boolean {
    return !!petPveGearById(pet.loadout?.pve)?.loyalty;
}

/** % of max HP to heal the player when summoning (0 if none). */
export function petPveHealOnSummonPct(pet: Pet): number {
    return petPveGearById(pet.loadout?.pve)?.healOnSummonPctOfMaxHp ?? 0;
}

/** % of the pet's dealt damage to heal the player for (0 if none). */
export function petPveLifestealPct(pet: Pet): number {
    return petPveGearById(pet.loadout?.pve)?.playerLifestealPct ?? 0;
}

// ── Battle consumables ───────────────────────────────────────────────────
// One-use items equipped in a pet's Consumable slot, spent the next time the
// pet fights. Unlike PVP/PVE gear (stat boosts), these are REACTIVE — a single
// charge that triggers on an event during a pet battle:
//   dodge    — negates the next `value` incoming attacks
//   endure   — survives one lethal blow (drops to 1 HP instead of 0)
//   thorns   — reflects `value`% of the next attack back at the attacker
//   lifeline — the first time it falls below 35% HP, heals `value`% max HP
//   cleanse  — once, purges all poisons/burns and freeze/confuse/stun
// Reactive effects fire in pet battles (where the pet takes hits and debuffs).
// When summoned into a PvE fight instead, the pet spends the item to shield
// you for PET_CONSUMABLE_PVE_HEAL_PCT% of your max HP. Single-use; stack in
// inventory; bought for ryo in the Shop.
export type PetConsumableEffect = "dodge" | "mitigate" | "endure" | "thorns" | "lifeline" | "cleanse";

export const PET_CONSUMABLE_PVE_HEAL_PCT = 25;
export const PET_CONSUMABLE_LIFELINE_THRESHOLD_PCT = 35;

export type PetConsumable = {
    id: string;
    name: string;
    rarity: "uncommon" | "rare";
    cost: number;       // ryo Shop price (expensive — single-use reactive items)
    /** @deprecated Retired craft-point price. The Crafter spends the exact recipe
     *  in shared/crafting-recipes.ts and nothing reads this field. */
    craftPts: number;
    desc: string;
    effect: PetConsumableEffect;
    value?: number;
};

export const petConsumables: PetConsumable[] = [
    { id: "consum-phantom-charm",     name: "Phantom Charm",     rarity: "uncommon", cost: 960,  craftPts: 170, desc: "Dodges the next attack",                              effect: "dodge",    value: 1 },
    // 600 (2026-10 item-use pass): the budget pick. At 960 it cost the same as
    // the Phantom Charm, which negates the hit it only halves.
    { id: "consum-smoke-pellet",      name: "Smoke Pellet",      rarity: "uncommon", cost: 600,  craftPts: 170, desc: "The next attack deals 50% less damage",                effect: "mitigate", value: 50 },
    { id: "consum-cleansing-incense", name: "Cleansing Incense", rarity: "uncommon", cost: 1120, craftPts: 200, desc: "Purges all poisons, burns, and control effects once", effect: "cleanse" },
    { id: "consum-thornmail-oil",     name: "Thornmail Oil",     rarity: "rare",     cost: 1280, craftPts: 220, desc: "Reflects 40% of the next attack back at the attacker", effect: "thorns",   value: 40 },
    { id: "consum-lifeline-elixir",   name: "Lifeline Elixir",   rarity: "rare",     cost: 1440, craftPts: 250, desc: "First time below 35% HP, heals 30% of max HP",        effect: "lifeline", value: 30 },
    { id: "consum-second-wind",       name: "Second Wind",       rarity: "rare",     cost: 1600, craftPts: 280, desc: "Survives one lethal blow (drops to 1 HP)",            effect: "endure" },
];

petConsumables.forEach((c) => stackableItemIds.add(c.id));

export function petConsumableById(consumableId?: string): PetConsumable | undefined {
    return consumableId ? petConsumables.find((c) => c.id === consumableId) : undefined;
}

// Reactive-charge values granted to a battle fighter by its equipped
// consumable. Read from loadout at fighter creation (symmetric → synced
// battles stay deterministic). All zero when nothing is equipped.
export function petConsumableCharges(pet: Pet): { dodge: number; mitigate: number; endure: number; thorns: number; lifeline: number; cleanse: number } {
    const c = petConsumableById(pet.loadout?.consumable);
    return {
        dodge:    c?.effect === "dodge"    ? (c.value ?? 1) : 0,
        mitigate: c?.effect === "mitigate" ? (c.value ?? 50) : 0,
        endure:   c?.effect === "endure"   ? 1 : 0,
        thorns:   c?.effect === "thorns"   ? (c.value ?? 50) : 0,
        lifeline: c?.effect === "lifeline" ? (c.value ?? 30) : 0,
        cleanse:  c?.effect === "cleanse"  ? 1 : 0,
    };
}

// ── Pet equipment slots ──────────────────────────────────────────────────
// Which items each Pet Yard slot takes. The equip route checks this, so a treat
// or a stray item id can never sit in the Consumable slot and heal like a real
// battle consumable (2026-10 item-use pass).
export type PetEquipSlot = "collar" | "pvp" | "pve" | "consumable";

const PET_SLOT_ITEM_IDS: Record<PetEquipSlot, ReadonlySet<string>> = {
    collar: petCollarIds,
    pvp: new Set(petPvpGear.map((g) => g.id)),
    pve: new Set(petPveGear.map((g) => g.id)),
    consumable: new Set(petConsumables.map((c) => c.id)),
};

export function petSlotAcceptsItem(slot: string, itemId?: string): boolean {
    const ids = (PET_SLOT_ITEM_IDS as Record<string, ReadonlySet<string> | undefined>)[slot];
    return !!ids && !!itemId && ids.has(itemId);
}

/** Collars and PvP gear are unlocks: one backpack copy equips on every pet and
 *  stays in the backpack. PvE gear and consumables move onto the pet instead. */
export const PET_UNLOCK_SLOTS = ["collar", "pvp"] as const;

export function isPetUnlockItem(itemId?: string): boolean {
    return PET_UNLOCK_SLOTS.some((slot) => petSlotAcceptsItem(slot, itemId));
}

// ── Pet supply hold cap ──────────────────────────────────────────────────
// Treats, the Golden Apple, PvE gear, battle consumables and evolution stones
// buy in bulk up to this many held, the same 50 the combat consumables use.
// Without a cap the shop sold them one at a time, and only from an empty stack
// (2026-10 item-use pass). Collars and PvP gear stay single-purchase unlocks.
export const PET_SUPPLY_HOLD_CAP = 50;
/** The two starter-pet evolution stones (api/pet/_evolution.ts requiredItem). */
export const PET_EVOLUTION_STONE_IDS = ["evo-stone-awakening", "evo-stone-ascension"] as const;

const PET_SUPPLY_IDS: ReadonlySet<string> = new Set<string>([
    ...petFeedItems.map((item) => item.id),
    ...petPveGear.map((g) => g.id),
    ...petConsumables.map((c) => c.id),
    ...PET_EVOLUTION_STONE_IDS,
]);

/** The most of a pet supply a player may hold through the shop, or null when
 *  the item is not one. */
export function petSupplyHoldCap(itemId?: string): number | null {
    return itemId && PET_SUPPLY_IDS.has(itemId) ? PET_SUPPLY_HOLD_CAP : null;
}
